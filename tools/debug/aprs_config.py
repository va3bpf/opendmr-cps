#!/usr/bin/env python3
"""APRS configuration management for OpenDMR radios (over the programming cable).

Lists the 8 APRS configurations in the radio's data flash, creates or updates them,
and supports special configurations for satellite beacons (e.g. ISS via ARISS).

Usage:
  py aprs_config.py COM6                  # list the 8 configurations
  py aprs_config.py COM6 --set-iss       # create 'ISS' with Vía 1 ARISS, icon '['

The configurations are 64 bytes each, 8 of them, at window address 0x1588
(cps layout.js APRS_CONFIGS), in the data flash window (area 1 of the cable link,
'R' / 'X' requests, as tools/satellite/write_keps.py).
"""
import argparse
import struct
import sys
import time

import serial

SECTOR = 4096
SECTOR_ADDRESS = 0x1000
APRS_AT = 0x1588 - SECTOR_ADDRESS     # inside that sector
CONFIG = 64
COUNT = 8
MAGIC = (0x4152, 0x4153)              # 'AR' / 'AS'


class Link:
    def __init__(self, port):
        self.p = serial.Serial(port, 115200, timeout=0.5)
        time.sleep(0.2)

    def request(self, data, length, header):
        for _ in range(3):
            self.p.reset_input_buffer()
            self.p.write(data)
            buf = b''
            end = time.time() + 3
            while time.time() < end and len(buf) < length:
                buf += self.p.read(max(1, self.p.in_waiting))
            if buf[:1] == b'-':
                raise RuntimeError('the radio refused %r' % data[:2])
            if buf[:len(header)] == header and len(buf) >= length:
                return buf[:length]
            time.sleep(0.2)
        raise RuntimeError('no reply to %r' % data[:2])

    def read(self, address, length):
        out = b''
        while len(out) < length:
            n = min(1024, length - len(out))
            out += self.request(b'R\x01' + struct.pack('>IH', address + len(out), n), 3 + n, b'R')[3:]
        return out

    def write_sector(self, sector, data):
        self.request(b'X\x01' + struct.pack('>I', sector)[1:], 2, b'X\x01')
        for i in range(0, SECTOR, 1024):
            self.request(b'X\x02' + struct.pack('>IH', sector * SECTOR + i, 1024) + data[i:i + 1024], 2, b'X\x02')
        self.request(b'X\x03', 2, b'X\x03')


def ascii_of(b):
    s = ''
    for c in b:
        if c in (0, 0xFF):
            break
        s += chr(c & 0x7F)
    return s


def show(rec):
    name = ascii_of(rec[0:8])
    magic = struct.unpack('<H', rec[62:64])[0]
    flags = rec[61]
    return '%-8s via1=%-6s/%d via2=%-6s/%d icon=%d flags=%02X (posfija=%s qsy=%s 300=%s) magic=%04X' % (
        name or '(libre)', ascii_of(rec[15:21]), rec[21], ascii_of(rec[22:28]), rec[28], rec[30], flags,
        'si' if flags & 0x02 else 'no', 'si' if flags & 0x04 else 'no', 'si' if flags & 0x01 else 'no', magic)


def new_iss():
    r = bytearray(b'\xFF' * CONFIG)
    name = b'ISS'
    r[0:len(name)] = name
    r[8] = 7                                    # SSID
    r[9:12] = b'\xFF\xFF\xFF'                   # no fixed position
    r[12:15] = b'\xFF\xFF\xFF'
    via1 = b'ARISS'
    r[15:15 + len(via1)] = via1
    r[21] = 0                                   # ARISS, no SSID
    r[22:28] = b'\xFF' * 6                      # no via 2
    r[28] = 0
    r[29] = 0                                   # primary icon table
    r[30] = 58                                  # '[': a person (a handheld)
    r[31:55] = b'\xFF' * 24                     # no comment
    r[55:59] = b'\x00\x00\x00\x00'              # Tx frequency: the channel's
    r[61] = 0x00                                # not 300 baud, no fixed position, no QSY, ambiguity 0
    r[62:64] = struct.pack('<H', MAGIC[1])      # 'AS'
    return bytes(r)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('port')
    ap.add_argument('--set-iss', action='store_true')
    args = ap.parse_args()

    link = Link(args.port)
    sector = link.read(SECTOR_ADDRESS, SECTOR)
    if link.read(SECTOR_ADDRESS, SECTOR) != sector:
        sys.exit('the two reads differ: nothing written')
    configs = [sector[APRS_AT + i * CONFIG: APRS_AT + (i + 1) * CONFIG] for i in range(COUNT)]
    for i, c in enumerate(configs):
        print('%d  %s' % (i + 1, show(c)))

    if not args.set_iss:
        return
    if any(ascii_of(c[0:8]).strip().upper() == 'ISS' and struct.unpack('<H', c[62:64])[0] in MAGIC
           for c in configs):
        print('ISS is already there: nothing written')
        return
    free = [i for i, c in enumerate(configs)
            if not ascii_of(c[0:8]).strip() or struct.unpack('<H', c[62:64])[0] not in MAGIC]
    if not free:
        sys.exit('no free APRS configuration')
    index = free[0]
    new = bytearray(sector)
    new[APRS_AT + index * CONFIG: APRS_AT + (index + 1) * CONFIG] = new_iss()
    link.write_sector(SECTOR_ADDRESS // SECTOR, bytes(new))
    if link.read(SECTOR_ADDRESS, SECTOR) != bytes(new):
        sys.exit('read back differs')
    print('ISS written in slot %d (via ARISS); open the APRS screen again' % (index + 1))


if __name__ == '__main__':
    main()