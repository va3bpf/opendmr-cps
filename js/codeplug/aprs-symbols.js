// Symbol descriptions follow the APRS symbols index by Hessu Hannikainen (CC BY-SA 4.0).
// https://github.com/hessu/aprs-symbol-index
const DESCRIPTIONS = {
    '/!': 'Police station', '/#': 'Digipeater', '/$': 'Telephone', '/%': 'DX cluster', '/&': 'HF gateway',
    "/'": 'Small aircraft', '/(': 'Mobile satellite station', '/)': 'Wheelchair', '/*': 'Snowmobile',
    '/+': 'Red Cross', '/,': 'Boy Scouts', '/-': 'House', '/.': 'Red X', '//': 'Red dot',
    '/:': 'Fire', '/;': 'Campground, tent', '/<': 'Motorcycle', '/=': 'Railroad engine', '/>': 'Car',
    '/?': 'File server', '/@': 'Hurricane predicted path', '/A': 'Aid station', '/B': 'BBS', '/C': 'Canoe',
    '/E': 'Eyeball', '/F': 'Farm vehicle, tractor', '/G': 'Grid square, 3 by 3', '/H': 'Hotel',
    '/I': 'TCP/IP network station', '/K': 'School', '/L': 'PC user', '/M': 'Mac apple', '/N': 'NTS station',
    '/O': 'Balloon', '/P': 'Police car', '/R': 'Recreational vehicle', '/S': 'Space Shuttle', '/T': 'SSTV',
    '/U': 'Bus', '/V': 'ATV, Amateur Television', '/W': 'Weather service site', '/X': 'Helicopter',
    '/Y': 'Sailboat', '/Z': 'Windows flag', '/[': 'Human', '/\\': 'DF triangle', '/]': 'Mailbox',
    '/^': 'Large aircraft', '/_': 'Weather station', '/`': 'Satellite dish antenna', '/a': 'Ambulance',
    '/b': 'Bicycle', '/c': 'Incident command post', '/d': 'Fire station', '/e': 'Horse, equestrian',
    '/f': 'Fire truck', '/g': 'Glider', '/h': 'Hospital', '/i': 'IOTA, islands on the air', '/j': 'Jeep',
    '/k': 'Truck', '/l': 'Laptop', '/m': 'Mic-E repeater', '/n': 'Node', '/o': 'Emergency operations center',
    '/p': 'Dog', '/q': 'Grid square, 2 by 2', '/r': 'Repeater tower', '/s': 'Ship, power boat',
    '/t': 'Truck stop', '/u': 'Semi-trailer truck', '/v': 'Van', '/w': 'Water station', '/x': 'X / Unix',
    '/y': 'House, yagi antenna', '/z': 'Shelter',
    '\\!': 'Emergency', '\\#': 'Digipeater, green star', '\\$': 'Bank or ATM', '\\&': 'Gateway station',
    "\\'": 'Crash / incident site', '\\(': 'Cloudy', '\\)': 'Firenet MEO', '\\*': 'Snow', '\\+': 'Church',
    '\\-': 'House, HF antenna', '\\.': 'Ambiguous, question mark inside circle', '\\/': 'Waypoint destination',
    '\\0': 'Circle, IRLP / Echolink / WIRES', '\\8': 'WiFi or network node', '\\9': 'Gas station',
    '\\:': 'Hail', '\\;': 'Park, picnic area', '\\<': 'Advisory, single red flag', '\\>': 'Red car',
    '\\@': 'Hurricane, tropical storm', '\\A': 'White box', '\\B': 'Blowing snow', '\\C': 'Coast Guard',
    '\\D': 'Drizzling rain', '\\E': 'Smoke, chimney', '\\F': 'Freezing rain', '\\G': 'Snow shower',
    '\\H': 'Haze', '\\I': 'Rain shower', '\\J': 'Lightning', '\\K': 'Kenwood HT', '\\L': 'Lighthouse',
    '\\N': 'Navigation buoy', '\\O': 'Rocket', '\\P': 'Parking', '\\Q': 'Earthquake', '\\R': 'Restaurant',
    '\\S': 'Satellite', '\\T': 'Thunderstorm', '\\U': 'Sunny', '\\V': 'VORTAC, navigational aid',
    '\\W': 'Weather service site', '\\X': 'Pharmacy', '\\^': 'Aircraft', '\\_': 'Weather site',
    '\\a': 'Red diamond', '\\b': 'Blowing dust, sand', '\\c': 'RACES / CERTS / SATERN',
    '\\d': 'DX spot', '\\e': 'Sleet', '\\f': 'Funnel cloud', '\\g': 'Gale', '\\h': 'Store',
    '\\i': 'Black box, point of interest', '\\j': 'Work zone, excavating machine', '\\k': 'SUV, ATV',
    '\\m': 'Value sign', '\\n': 'Red triangle', '\\o': 'Small circle', '\\p': 'Partly cloudy',
    '\\r': 'Restrooms', '\\s': 'Ship, boat', '\\t': 'Tornado', '\\u': 'Truck', '\\v': 'Van',
    '\\w': 'Flooding', '\\y': 'Skywarn', '\\z': 'Shelter',
};

export function aprsSymbols(table) {
    const prefix = table === 1 ? '\\' : '/';
    return Array.from({length: 94}, (_, value) => {
        const character = String.fromCharCode(value + 33);
        const code = prefix + character;
        return {value, character, code, description: DESCRIPTIONS[code] ?? 'APRS symbol'};
    });
}
