const STARTING_LOCATIONS = [
  "001 Galveston",
  "003 Brazoria",
  "004 League City",
  "006 Bastrop",
  "007 Brownwood",
  "008 Stephenville",
  "010 Belton",
  "011 South Austin",
  "012 Weimar",
  "013 Richwood",
  "015 Harlingen",
  "016 New Braunfels",
  "017 N Corpus Christi",
  "018 Abilene",
  "019 Midland",
  "020 Victoria",
  "022 Greenville",
  "024 Pasadena",
  "025 NW San Antonio",
  "027 SE San Antonio",
  "028 Baytown",
  "029 S Corpus Christi",
  "030 San Angelo",
  "032 Palestine",
  "033 Pharr",
  "034 Bryan",
  "035 Odessa",
  "036 Lufkin",
  "037 Brownsville",
  "038 Rosenberg",
  "039 Longview",
  "040 Beeville",
  "041 Laredo",
  "042 Las Cruces",
  "043 Huntsville",
  "044 Kerrville",
  "047 Waco",
  "049 Tyler",
  "050 SC San Antonio",
  "052 Cleburne",
  "053 Taylor",
  "055 Georgetown",
  "057 Tomball",
  "058 Gonzales",
  "059 Corsicana",
  "060 Brenham",
  "061 Mt. Pleasant",
  "062 Austin Manchaca",
  "063 Gainesville",
  "064 Orange",
  "066 Alice",
  "067 Terrell",
  "068 Plainview",
  "069 Austin 290 West",
  "070 San Marcos",
  "071 Nacogdoches",
  "072 Paris",
  "074 Bee Cave",
  "075 El Paso",
  "077 Searcy",
  "081 Lawton",
  "082 Ardmore",
  "083 Duncan",
  "084 Hobbs",
  "085 Roswell",
  "086 Alpine",
  "087 Fort Stockton",
  "088 Del Rio",
  "089 Mission",
  "090 Okmulgee",
  "091 Carlsbad",
  "093 Weslaco",
  "094 Vicksburg",
  "096 El Campo",
  "097 Eagle Pass",
  "098 Cleveland",
  "100 Edinburg",
  "101 Universal City",
  "103 San Benito",
  "106 Kingsville",
  "107 Laurel",
  "108 Rio Grande City",
  "109 Aransas Pass",
  "111 Floresville",
  "112 Dayton",
  "113 Montgomery",
  "114 Alvin",
  "115 Midlothian",
  "116 Bay City",
  "117 Liberty Hill",
  "118 Spicewood",
  "119 Lubbock",
  "120 Lockhart",
  "121 New Caney",
  "345 Mission Cross Dock",
  "352 Waco Cross Dock",
  "353 Dayton Distribution",
  "355 Pharr Reload",
  "355 Pharr Central Delivery",
  "356 Midland Distribution Center",
  "357 Window Delivery",
  "359 Burnet Reload",
  "450 McCoys Millworks",
  "450 Old Millwork",
  "479 Rebar Bender",
  "489 EWP Program",
  "508 The Retreat",
  "705 Store Planning",
  "730 Store Development",
  "735 Fleet",
  "750 Real Estate",
  "761 Region 1",
  "762 Region 2",
  "763 Region 3",
  "764 Region 4",
  "765 Region 5",
  "766 Region 6",
  "767 Region 7",
  "768 Region 8",
  "769 Area 9",
  "900 Corporate",
  "901 McCoy Properties",
  "950 Rio Truss"
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
