// ============================================================================
// data.js — SEED DATA ONLY
//
// These lists are used ONLY the first time the site connects to an empty
// Firebase project. Once Firebase has been seeded (parts, settings/users,
// settings/locations all exist), the live app reads from Firestore instead
// and these constants are never used.
//
// To add/remove users, locations, or parts in normal operation, use the
// Admin page — not this file.
// ============================================================================

const STARTING_LOCATIONS = [
  { name: "001 Galveston", phone: "409-744-3401", address: "7500 Broadway Street", city: "Galveston", state: "TX", zip: "77554-8922" },
  { name: "003 Brazoria", phone: "979-258-7204", address: "1308 S. Brooks", city: "Brazoria", state: "TX", zip: "77422-8484" },
  { name: "004 League City", phone: "281-332-2731", address: "1302 Highway 3 South", city: "League City", state: "TX", zip: "77573-5416" },
  { name: "006 Bastrop", phone: "512-321-3999", address: "801 W State Hwy 71", city: "Bastrop", state: "TX", zip: "78602-3735" },
  { name: "007 Brownwood", phone: "325-643-2638", address: "3605 Highway 377 South", city: "Brownwood", state: "TX", zip: "76801-5115" },
  { name: "008 Stephenville", phone: "254-968-3184", address: "3001 Northwest Loop", city: "Stephenville", state: "TX", zip: "76401-1641" },
  { name: "010 Belton", phone: "254-939-1131", address: "212 Ih-35 North", city: "Belton", state: "TX", zip: "76513-3570" },
  { name: "011 South Austin", phone: "512-385-3866", address: "6200 Burleson Road", city: "Austin", state: "TX", zip: "78744-1331" },
  { name: "012 Weimar", phone: "979-493-7100", address: "805 County Road", city: "Weimar", state: "TX", zip: "78962-5166" },
  { name: "013 Richwood", phone: "979-265-7483", address: "1300 Highway 288 B", city: "Richwood", state: "TX", zip: "77531-3231" },
  { name: "015 Harlingen", phone: "956-428-4901", address: "3601 West Expressway 83", city: "Harlingen", state: "TX", zip: "78552-3502" },
  { name: "016 New Braunfels", phone: "830-629-2111", address: "3518 Loop 337", city: "New Braunfels", state: "TX", zip: "78130-7316" },
  { name: "017 N Corpus Christi", phone: "361-289-2832", address: "1602 North Padre Island Drive", city: "Corpus Christi", state: "TX", zip: "78408-2345" },
  { name: "018 Abilene", phone: "325-691-9155", address: "5226 Us Highway 277 S", city: "Abilene", state: "TX", zip: "79603-5326" },
  { name: "019 Midland", phone: "432-697-5831", address: "3112 West Front Avenue", city: "Midland", state: "TX", zip: "79701-7139" },
  { name: "020 Victoria", phone: "361-578-5151", address: "5803 Ne Zac Lentz Parkway", city: "Victoria", state: "TX", zip: "77904-3609" },
  { name: "024 Pasadena", phone: "281-487-7888", address: "6100 Red Bluff Rd.", city: "Pasadena", state: "TX", zip: "77505-3604" },
  { name: "025 NW San Antonio", phone: "210-680-0080", address: "5500 Bandera Road", city: "San Antonio", state: "TX", zip: "78238-1913" },
  { name: "027 SE San Antonio", phone: "210-532-5556", address: "8212 South Presa", city: "San Antonio", state: "TX", zip: "78223-3539" },
  { name: "028 Baytown", phone: "281-427-4319", address: "330 Ward Road", city: "Baytown", state: "TX", zip: "77520-4855" },
  { name: "029 S Corpus Christi", phone: "361-992-0555", address: "5909 Holly Road", city: "Corpus Christi", state: "TX", zip: "78412-4553" },
  { name: "030 San Angelo", phone: "325-944-3100", address: "2031 Loop 306", city: "San Angelo", state: "TX", zip: "76904-6855" },
  { name: "032 Palestine", phone: "903-723-2555", address: "2200 West Oak Street", city: "Palestine", state: "TX", zip: "75801-4049" },
  { name: "033 Pharr", phone: "956-787-1000", address: "1120 West Highway 83", city: "Pharr", state: "TX", zip: "78577-4581" },
  { name: "034 Bryan", phone: "979-776-6070", address: "2300 Boonville Road", city: "Bryan", state: "TX", zip: "77808-2225" },
  { name: "035 Odessa", phone: "432-368-9315", address: "1131 West 42nd Street", city: "Odessa", state: "TX", zip: "79764-4077" },
  { name: "036 Lufkin", phone: "936-632-3593", address: "North Loop 287 Mlk Jr. Drive", city: "Lufkin", state: "TX", zip: "75904-1231" },
  { name: "037 Brownsville", phone: "956-831-9887", address: "5500 South Padre Island Blvd.", city: "Brownsville", state: "TX", zip: "78521-4411" },
  { name: "038 Rosenberg", phone: "281-232-3575", address: "5015 Avenue H", city: "Rosenberg", state: "TX", zip: "77471-5631" },
  { name: "039 Longview", phone: "903-753-0511", address: "2500 Alpine Street", city: "Longview", state: "TX", zip: "75605-4097" },
  { name: "040 Beeville", phone: "361-358-5111", address: "170 W Fm351", city: "Beeville", state: "TX", zip: "78102-2455" },
  { name: "041 Laredo", phone: "956-722-0596", address: "3809 E. Saunders St.", city: "Laredo", state: "TX", zip: "78041-9700" },
  { name: "042 Las Cruces", phone: "575-526-9207", address: "1856 South Valley Drive", city: "Las Cruces", state: "NM", zip: "88005-3148" },
  { name: "043 Huntsville", phone: "936-295-4200", address: "6021 Hwy. 75 South", city: "Huntsville", state: "TX", zip: "77340-7258" },
  { name: "044 Kerrville", phone: "830-896-8171", address: "1825 Sidney Baker", city: "Kerrville", state: "TX", zip: "78028-2643" },
  { name: "047 Waco", phone: "254-772-7826", address: "4236 Franklin Avenue", city: "Waco", state: "TX", zip: "76710-6944" },
  { name: "049 Tyler", phone: "903-595-1289", address: "1000 South Southwest Loop 323", city: "Tyler", state: "TX", zip: "75701-1042" },
  { name: "050 SC San Antonio", phone: "210-434-4070", address: "1654 S. General Mcmullen Drive", city: "San Antonio", state: "TX", zip: "78237-4421" },
  { name: "052 Cleburne", phone: "817-641-0212", address: "3208 North Main", city: "Cleburne", state: "TX", zip: "76031-5058" },
  { name: "053 Taylor", phone: "512-352-6016", address: "3401 North Main", city: "Taylor", state: "TX", zip: "76574" },
  { name: "055 Georgetown", phone: "512-863-0865", address: "100 Leander Road", city: "Georgetown", state: "TX", zip: "78626-8456" },
  { name: "057 Tomball", phone: "281-255-3168", address: "28113 Tomball Parkway", city: "Tomball", state: "TX", zip: "77375-6419" },
  { name: "058 Gonzales", phone: "830-672-9026", address: "2845 Highway 183 North", city: "Gonzales", state: "TX", zip: "78629-2173" },
  { name: "060 Brenham", phone: "979-836-6766", address: "1803 U.S. Hwy. 290 East", city: "Brenham", state: "TX", zip: "77833-5933" },
  { name: "061 Mt. Pleasant", phone: "903-572-9281", address: "1702 West 16th Street", city: "Mount Pleasant", state: "TX", zip: "75455-2089" },
  { name: "062 Austin Manchaca", phone: "512-280-3080", address: "1305 Fm 1626", city: "Manchaca", state: "TX", zip: "78652-3547" },
  { name: "063 Gainesville", phone: "940-668-8082", address: "2507 West Highway 82", city: "Gainesville", state: "TX", zip: "76240-2076" },
  { name: "066 Alice", phone: "361-664-1517", address: "3761 East Hwy. 44", city: "Alice", state: "TX", zip: "78332-6972" },
  { name: "067 Terrell", phone: "972-524-5330", address: "1600 State Hwy 34 South", city: "Terrell", state: "TX", zip: "75160-5407" },
  { name: "069 Austin 290 West", phone: "512-288-3313", address: "11811 Highway 290 West", city: "Austin", state: "TX", zip: "78737-2812" },
  { name: "070 San Marcos", phone: "512-396-1755", address: "110 Wonder World Drive", city: "San Marcos", state: "TX", zip: "78666-9770" },
  { name: "071 Nacogdoches", phone: "936-569-0670", address: "4009 Northwest Stallings Drive", city: "Nacogdoches", state: "TX", zip: "75964-9147" },
  { name: "072 Paris", phone: "903-785-0200", address: "3525 North Main Street", city: "Paris", state: "TX", zip: "75460-9502" },
  { name: "074 Bee Cave", phone: "512-263-3527", address: "13324 Highway 71 West", city: "Austin", state: "TX", zip: "78738-3103" },
  { name: "075 El Paso HP", phone: "915-751-8261", address: "9001 Gateway Blvd. South", city: "El Paso", state: "TX", zip: "79904-1215" },
  { name: "082 Ardmore", phone: "580-226-8820", address: "3405 West Broadway Street", city: "Ardmore", state: "OK", zip: "73401-9072" },
  { name: "083 Duncan", phone: "580-252-4222", address: "4799 N. Hwy. 81", city: "Duncan", state: "OK", zip: "73533-8996" },
  { name: "084 Hobbs", phone: "575-392-1932", address: "2406 North Dal Paso", city: "Hobbs", state: "NM", zip: "88240-2309" },
  { name: "085 Roswell", phone: "575-622-0220", address: "2100 Southeast Main", city: "Roswell", state: "NM", zip: "88203-5924" },
  { name: "086 Alpine", phone: "432-837-7429", address: "2700 E. Highway 90", city: "Alpine", state: "TX", zip: "79831" },
  { name: "087 Fort Stockton", phone: "432-336-2628", address: "1300 North U.S. Highway 285", city: "Fort Stockton", state: "TX", zip: "79735-4409" },
  { name: "088 Del Rio", phone: "830-775-2484", address: "805 Spur 239", city: "Del Rio", state: "TX", zip: "78840" },
  { name: "089 Mission", phone: "956-580-2550", address: "200 West Expressway 83", city: "Mission", state: "TX", zip: "78572-6167" },
  { name: "090 Okmulgee", phone: "918-756-0350", address: "3428 North Wood Drive", city: "Okmulgee", state: "OK", zip: "74447-7945" },
  { name: "091 Carlsbad", phone: "575-887-6360", address: "303 East Wood", city: "Carlsbad", state: "NM", zip: "88220-6500" },
  { name: "093 Weslaco", phone: "956-968-4793", address: "910 U.S. Expressway 83", city: "Weslaco", state: "TX", zip: "78596-4327" },
  { name: "096 El Campo", phone: "979-543-3878", address: "1920 S. Mechanic St.", city: "El Campo", state: "TX", zip: "77437-9100" },
  { name: "097 Eagle Pass", phone: "830-757-2945", address: "3030 East Main", city: "Eagle Pass", state: "TX", zip: "78852-5744" },
  { name: "098 Cleveland", phone: "281-592-2465", address: "1000 Frontage Street South", city: "Cleveland", state: "TX", zip: "77327-6039" },
  { name: "100 Edinburg", phone: "956-383-3304", address: "2901 West University Dr.", city: "Edinburg", state: "TX", zip: "78539-8847" },
  { name: "101 Universal City", phone: "210-945-0286", address: "1025 Kitty Hawk Road", city: "Universal City", state: "TX", zip: "78148-3747" },
  { name: "103 San Benito", phone: "956-361-0385", address: "1701 Industrial Way", city: "San Benito", state: "TX", zip: "78586-7735" },
  { name: "108 Rio Grande City", phone: "956-487-2135", address: "4759 E. Highway 83", city: "Rio Grande City", state: "TX", zip: "78582-6309" },
  { name: "109 Aransas Pass", phone: "361-758-8081", address: "2118 West Wheeler Avenue", city: "Aransas Pass", state: "TX", zip: "78336-4711" },
  { name: "111 Floresville", phone: "830-393-2938", address: "149 Wilson Drive", city: "Floresville", state: "TX", zip: "78114" },
  { name: "112 Dayton", phone: "936-367-7777", address: "810 S. Highway 146", city: "Dayton", state: "TX", zip: "77535" },
  { name: "113 Montgomery", phone: "936-597-3987", address: "20341 Eva Street", city: "Montgomery", state: "TX", zip: "77356" },
  { name: "114 Alvin", phone: "281-485-8880", address: "675 Fm 517", city: "Alvin", state: "TX", zip: "77511" },
  { name: "115 Midlothian", phone: "469-672-8999", address: "4070 East U.S. Hwy. 287", city: "Midlothian", state: "TX", zip: "76065" },
  { name: "116 Bay City", phone: "979-318-7260", address: "1927 Hubbard St", city: "Bay City", state: "TX", zip: "77414-1772" },
  { name: "117 Liberty Hill", phone: "512-778-7002", address: "2505 Rm 1869", city: "Liberty Hill", state: "TX", zip: "78642" },
  { name: "118 Spicewood", phone: "512-712-7113", address: "23400 Tx-71 W", city: "Spicewood", state: "TX", zip: "78669" },
  { name: "119 Lubbock", phone: "806-503-6493", address: "11801 Quaker Ave.", city: "Lubbock", state: "TX", zip: "79423" },
  { name: "120 Lockhart", phone: "512-359-6011", address: "1600 S. Colorado St.", city: "Lockhart", state: "TX", zip: "78644" },
  { name: "121 New Caney", phone: "", address: "21989 Highway 242", city: "New Caney", state: "TX", zip: "77357" },
  { name: "353 Dayton Distribution", phone: "936-367-7025", address: "980 Hwy. 146", city: "Dayton", state: "TX", zip: "77535" },
  { name: "355 Pharr Reload", phone: "956-787-1000", address: "1120 West Highway 83", city: "Pharr", state: "TX", zip: "78577-4581" },
  { name: "356 Midland DC", phone: "432-253-8440", address: "3001 W. Kentucky Ave.", city: "Midland", state: "TX", zip: "79701" },
  { name: "359 Burnet Reload", phone: "512-715-8880", address: "4304 State Hwy 29 East", city: "Burnet", state: "TX", zip: "78611" },
  { name: "450 Millwork NB", phone: "830-624-1151", address: "710 Fm 306", city: "New Braunfels", state: "TX", zip: "78130-2548" },
  { name: "479 Burnet Manufacturing", phone: "512-715-8880", address: "4304 State Hwy 29 East", city: "Burnet", state: "TX", zip: "78611" },
  { name: "489 Burnet EWP", phone: "512-715-8880", address: "4304 State Hwy 29 East", city: "Burnet", state: "TX", zip: "78611" },
  { name: "950 Rio Truss", phone: "956-682-9822", address: "100 N Bentson Rd", city: "Mcallen", state: "TX", zip: "78501" }
];

const STARTING_PARTS = [
  {
    "rackingType": "Pallet Rack",
    "name": "12' Tall x 48\" Deep x 13 Gauge Uprights w/ 5\" x 7\" x 1/4\" Footplates Green ",
    "startingQuantity": 54,
    "costEach": 221.55
  },
  {
    "rackingType": "Pallet Rack",
    "name": "6\" x9'x 14 Gauge Step Beams Green",
    "startingQuantity": 321,
    "costEach": 94.6
  },
  {
    "rackingType": "Pallet Rack",
    "name": "14' Tall x 48\" Deep x 13 Gauge Uprights w/ 5\" x 7\" x 1/4\" Footplates Green ",
    "startingQuantity": 0,
    "costEach": 0.0
  },
  {
    "rackingType": "Pallet Rack",
    "name": "12' Tall x 48\" Deep x 13 Gauge Uprights w/ 5\" x 7\" x 1/4\" Footplates Galvanized",
    "startingQuantity": 31,
    "costEach": 296.4
  },
  {
    "rackingType": "Pallet Rack",
    "name": "6\" x9'x 14 Gauge Step Beams Galvanized",
    "startingQuantity": 119,
    "costEach": 109.2
  },
  {
    "rackingType": "Cantilever Rack",
    "name": "8\"x13' Cantilever Colums Green",
    "startingQuantity": 22,
    "costEach": 255.2
  },
  {
    "rackingType": "Cantilever Rack",
    "name": "4\" x 52\" Catilever Arms Green",
    "startingQuantity": 105,
    "costEach": 99.87
  },
  {
    "rackingType": "Cantilever Rack",
    "name": "6\" x 52\" Catilever Arms Green",
    "startingQuantity": 0,
    "costEach": 108.56
  },
  {
    "rackingType": "Cantilever Rack",
    "name": "8\" x 52\" Catilever Base Green",
    "startingQuantity": 23,
    "costEach": 219.88
  },
  {
    "rackingType": "Cantilever Rack",
    "name": "5' x 4' Brace Panels Green",
    "startingQuantity": 37,
    "costEach": 83.5
  },
  {
    "rackingType": "Cantilever Rack",
    "name": "5' Horizontal Bracews Green",
    "startingQuantity": 20,
    "costEach": 23.14
  },
  {
    "rackingType": "Cantilever Rack",
    "name": "4\" x 52\" Catilever Arms Galvanized",
    "startingQuantity": 11,
    "costEach": 169.05
  },
  {
    "rackingType": "Cantilever Rack",
    "name": "6\" x 52\" Catilever Arms Galvanized",
    "startingQuantity": 15,
    "costEach": 185.93
  },
  {
    "rackingType": "Cantilever Rack",
    "name": "8\" x 52\" Catilever Base Galvanized",
    "startingQuantity": 10,
    "costEach": 271.85
  },
  {
    "rackingType": "Pigeon Hole Rack",
    "name": "4\" x 9' 16 Gauge step beam Floor & Middle ",
    "startingQuantity": 396,
    "costEach": 73.44
  },
  {
    "rackingType": "Pigeon Hole Rack",
    "name": "3 1/2\" x 9' 16 Gauge Drop Floor Beams  Galvanized",
    "startingQuantity": 60,
    "costEach": 73.44
  },
  {
    "rackingType": "Pigeon Hole Rack",
    "name": "3 1/2\" x 9' 16 Gauge Step Beams Galvanized",
    "startingQuantity": 117,
    "costEach": 73.44
  },
  {
    "rackingType": "Pigeon Hole Rack",
    "name": "15' x 48\" 14 Gauge Pigeon Hole Upright Galvanized",
    "startingQuantity": 16,
    "costEach": 340.0
  },
  {
    "rackingType": "Pigeon Hole Rack",
    "name": "15' x 36\" 14 Gauge Pigeon Hole Upright Galvanized",
    "startingQuantity": 33,
    "costEach": 260.0
  },
  {
    "rackingType": "Pigeon Hole Rack",
    "name": "11' x 48\" 14 Gauge Pigeon Hole Upright  w/Built-In Handrail Galvanized",
    "startingQuantity": 7,
    "costEach": 330.2
  },
  {
    "rackingType": "Pigeon Hole Rack",
    "name": "15' / 11'  x 48\" 14 Gauge HiLo Pigeon Hole Upright w/Built In Handrail Galvanized",
    "startingQuantity": 18,
    "costEach": 239.2
  },
  {
    "rackingType": "Pigeon Hole Rack",
    "name": "15' / 11'  x 48\" 14 Gauge HiLo Pigeon Hole Upright w/ No Bracing Above 88\" Galvanized",
    "startingQuantity": 34,
    "costEach": 252.2
  },
  {
    "rackingType": "Pigeon Hole Rack",
    "name": "3\" X 88\" Divider Channels Galvanized",
    "startingQuantity": 61,
    "costEach": 44.32
  },
  {
    "rackingType": "Pigeon Hole Rack",
    "name": "1 1/2\" x88\" Divider Channels Galvanized ",
    "startingQuantity": 32,
    "costEach": 31.52
  }
];

const STARTING_USERS = [
  "Alex Reyes",
  "Carlos Garcia",
  "Chet Lange",
  "Greg Wallace",
  "Hector Cerda",
  "Jeff Schaefer",
  "Jose Hernandez",
  "Leeland Weiss",
  "Luis Garcia",
  "Rigo Elizondo",
  "Steven McCormick",
  "Shae Davis"
];
