import { LaunchSite } from '../types/weather';

export const launchSites: LaunchSite[] = [
  {
    id: 'tollhouse',
    name: 'Tollhouse',
    elevation: 4200,
    latitude: 37.0331,
    longitude: -119.3372,
    orientation: 'SSE-WNW',
    maxWind: 17,
    siteType: 'thermal',  // Central Valley thermal site - thermals come up the hill from wide range
    state: 'CA'
  },
  {
    id: 'ed-levin',
    name: 'Ed Levin',
    elevation: 1750,
    latitude: 37.4656,
    longitude: -121.8531,
    orientation: 'S-NW',
    maxWind: 20,
    siteType: 'mixed',  // Training hill + thermals
    state: 'CA'
  },
  {
    id: 'mt-vaca',
    name: 'Mt Vaca',
    elevation: 2800,
    latitude: 38.4000,
    longitude: -122.1060,
    orientation: 'ALL',
    maxWind: 7,
    siteType: 'thermal',  // No real LZ - thermal only. Light wind any direction; 5mph east cross is ideal
    state: 'CA'
  },
  {
    id: 'slide',
    name: 'Slide Mountain',
    elevation: 9600,
    latitude: 39.2900,
    longitude: -119.9400,
    orientation: 'W-NW',
    maxWind: 25,
    siteType: 'thermal',  // High altitude thermal
    state: 'CA'
  },
  {
    id: 'whaleback',
    name: 'Whaleback',
    elevation: 7437,
    latitude: 41.5340,
    longitude: -122.1530,
    orientation: 'NW-SW',
    maxWind: 14,
    siteType: 'thermal',  // High altitude thermal near Mt Shasta
    state: 'CA'
  },
  {
    id: 'blue-rock',
    name: 'Blue Rock',
    elevation: 660,
    latitude: 38.1385,
    longitude: -122.1955,
    orientation: 'NNW-SSW',
    maxWind: 20,
    siteType: 'mixed',  // Ridge + thermal; launchable NNW through W to SSW, 8-20mph
    state: 'CA'
  },
  {
    id: 'mt-diablo',
    name: 'Mt Diablo',
    elevation: 3140,
    latitude: 37.8825,
    longitude: -121.9478,
    orientation: 'ESE-ENE',
    maxWind: 20,
    siteType: 'thermal',  // Default launch: Moses Rock Ridge (W-NE). Combined wind acceptance
    // covers all four Mt Diablo launches: Juniper (SW-W), Moses Rock Ridge (W-NE),
    // South (ESE-S), Tower (NW-NE). Gap is ~75-105° (E). See wingsofrogallo.org/mt-diablo.
    state: 'CA'
  },
  {
    id: 'mission-peak',
    name: 'Mission Peak',
    elevation: 2517,
    latitude: 37.5133,
    longitude: -121.8808,
    orientation: 'W-NW',
    maxWind: 22,
    siteType: 'mixed',  // Ridge + thermal
    state: 'CA'
  },
  {
    id: 'potato-hill',
    name: 'Potato Hill',
    elevation: 3400,
    latitude: 39.3410,
    longitude: -122.6850,
    orientation: 'NE-E',
    maxWind: 18,
    siteType: 'mixed',  // Training site, both modes; launch faces ENE, west winds are OTB hazard
    state: 'CA'
  },
  {
    id: 'mt-tamalpais',
    name: 'Mt Tamalpais',
    elevation: 2574,
    latitude: 37.9236,
    longitude: -122.5969,
    orientation: 'W-SW',
    maxWind: 25,
    siteType: 'soaring',  // Coastal ridge soaring
    state: 'CA'
  },
  {
    id: 'dunlap',
    name: 'Dunlap',
    elevation: 3200,
    latitude: 36.7400,
    longitude: -119.1000,
    orientation: 'SW-W',
    maxWind: 20,
    siteType: 'thermal',  // Famous XC thermal site
    state: 'CA'
  },
  {
    id: 'mcgee',
    name: 'McGee',
    elevation: 8500,
    latitude: 37.5800,
    longitude: -118.8300,
    orientation: 'E-SE',
    maxWind: 22,
    siteType: 'thermal',  // High Sierra thermal
    state: 'CA'
  },
  {
    id: 'mussel-rock',
    name: 'Mussel Rock',
    elevation: 160,
    latitude: 37.6600,
    longitude: -122.4900,
    orientation: 'W-NW',
    maxWind: 25,
    siteType: 'soaring',  // Coastal ridge only
    state: 'CA'
  },
  {
    id: 'ej-bowl',
    name: 'EJ Bowl',
    elevation: 250,
    latitude: 34.4940,
    longitude: -119.7030,
    orientation: 'W-NW',
    maxWind: 22,
    siteType: 'soaring',  // Coastal ridge soaring
    state: 'CA'
  },
  {
    id: 'big-sur',
    name: 'Big Sur',
    elevation: 3240,
    latitude: 35.9703,
    longitude: -121.4511,
    orientation: 'W-NW',
    maxWind: 15,
    siteType: 'soaring',  // Coastal ridge soaring
    state: 'CA'
  },
  {
    id: 'sand-city',
    name: 'Sand City',
    elevation: 50,
    latitude: 36.6252,
    longitude: -121.8439,
    orientation: 'W-NW',
    maxWind: 18,
    siteType: 'soaring',  // Coastal dune soaring
    state: 'CA'
  },
  {
    id: 'goat-rock',
    name: 'Goat Rock',
    elevation: 160,
    latitude: 38.4467,
    longitude: -123.1264,
    orientation: 'W-NW',
    maxWind: 18,
    siteType: 'soaring',  // Coastal cliff soaring
    state: 'CA'
  },
  {
    id: 'channing-east',
    name: 'Channing East',
    elevation: 200,
    latitude: 38.0686,
    longitude: -122.1472,
    orientation: 'NE-SE',
    maxWind: 12,
    siteType: 'mixed',  // Ridge + thermal
    state: 'CA'
  },
  {
    id: 'paiute',
    name: 'Paiute',
    elevation: 8000,
    latitude: 37.4100,
    longitude: -118.2700,
    orientation: 'SW-NW',
    maxWind: 15,
    siteType: 'thermal',  // White Mountains thermal
    state: 'CA'
  },
  {
    id: 'flynns',
    name: 'Flynns',
    elevation: 5600,
    latitude: 37.3884,
    longitude: -118.2950,
    orientation: 'W-NW',
    maxWind: 15,
    siteType: 'thermal',  // Owens Valley thermal
    state: 'CA'
  },
  {
    id: 'vollmer-peak',
    name: 'Vollmer Peak',
    elevation: 1905,
    latitude: 37.8838,
    longitude: -122.2204,
    orientation: 'NE-SE',
    maxWind: 18,
    siteType: 'mixed',  // Berkeley Hills ridge + thermal
    state: 'CA'
  },
  {
    id: 'mt-st-helena',
    name: 'Mt St Helena',
    elevation: 3800,
    latitude: 38.6694,
    longitude: -122.6361,
    orientation: 'NW-SW',
    maxWind: 14,
    siteType: 'thermal',  // Mayacamas Mountains thermal, Napa Valley
    state: 'CA'
  },
  {
    id: 'windy-hill',
    name: 'Windy Hill',
    elevation: 1910,
    latitude: 37.3709,
    longitude: -122.2228,
    orientation: 'NNE-ENE',
    maxWind: 20,
    siteType: 'soaring',  // NE-facing ridge soaring, Portola Valley
    state: 'CA'
  },

  // --- Pennsylvania ---
  {
    id: 'little-gap',
    name: 'Little Gap',
    elevation: 1340,
    latitude: 40.8075,
    longitude: -75.5481,
    orientation: 'NW-NE',  // paratrace: "Need NW -N- NE winds"
    maxWind: 20,
    siteType: 'mixed',  // Blue Mountain ridge; strong mid-day thermals, Allentown Class C airspace 2800-4400 msl behind ridge
    state: 'PA'
  },
  {
    id: 'hyner-view',
    name: 'Hyner View',
    elevation: 1940,
    latitude: 41.3265,
    longitude: -77.6240,
    orientation: 'W-NW',  // Overlook ramp above West Branch Susquehanna
    maxWind: 18,
    siteType: 'thermal',  // State park ramp; DCNR authorization required (handled by Hyner Hang Gliding Club)
    state: 'PA'
  },

  // --- New York ---
  {
    id: 'ellenville',
    name: 'Ellenville',
    elevation: 1380,
    latitude: 41.6726,
    longitude: -74.4032,
    orientation: 'WNW-NW',  // flyappi/XContest: "launch faces WNW - NW"; Shawangunk Ridge
    maxWind: 20,
    siteType: 'mixed',  // Hudson Valley Free Flyers site; USHPA rating required, check in at LZ
    state: 'NY'
  },
  {
    id: 'mt-brace',
    name: 'Mt Brace',
    elevation: 2300,
    latitude: 42.0444,
    longitude: -73.4927,
    orientation: 'WSW-WNW',  // mtbraceclub.com: ideal 250-290° (west-facing)
    maxWind: 20,
    siteType: 'mixed',  // Taconic range; club observer required for P2 first 10 flights
    state: 'NY'
  },

  // --- Vermont ---
  {
    id: 'mt-ascutney',
    name: 'Mt Ascutney',
    elevation: 3115,
    latitude: 43.4434,
    longitude: -72.4542,
    orientation: 'SSW-SSE',  // South Peak primary launch (sunny S face); VHGA
    maxWind: 18,
    siteType: 'thermal',  // State park, toll road to launch; VHGA waiver + intro required
    state: 'VT'
  },
  {
    id: 'rutland',
    name: 'Rutland (Birdseye)',
    elevation: 2290,
    latitude: 43.5578,
    longitude: -73.1086,
    orientation: 'S-W',  // VHGA: SW-facing ridge
    maxWind: 18,
    siteType: 'mixed',  // Birdseye Mountain; locked gate, 4x4 drive-up; VHGA waiver + observer for P2
    state: 'VT'
  },

  // --- Massachusetts ---
  {
    id: 'mt-greylock',
    name: 'Mt Greylock',
    elevation: 3466,
    latitude: 42.637,
    longitude: -73.1674,
    orientation: 'E-SE',  // flyappi: "launch is on the peak of the mountain facing southeast"
    maxWind: 20,
    siteType: 'mixed',  // MA highpoint; MassHGA waiver + lodge sign-in; no top landing; seasonal DCR blackouts
    state: 'MA'
  },
  {
    id: 'mt-tom',
    name: 'Mt Tom',
    elevation: 1190,
    latitude: 42.2417,
    longitude: -72.6481,
    orientation: 'W-NW',  // Cliff launch facing Easthampton/Connecticut River valley
    maxWind: 18,
    siteType: 'mixed',  // Traprock cliff launch — "technical takeoff"; NEPHC waiver + site intro
    state: 'MA'
  },
  {
    id: 'cape-cod',
    name: 'Cape Cod (White Crest)',
    elevation: 70,
    latitude: 41.9340,
    longitude: -69.9790,
    orientation: 'NE-E',  // ENE-facing coastal dunes at Wellfleet
    maxWind: 18,
    siteType: 'soaring',  // Dune soaring; Oct-mid-Apr only (plover nesting closes Apr-Oct); NEPHC waiver
    state: 'MA'
  },

  // --- Pennsylvania (CHGPA) ---
  {
    id: 'pulpit',
    name: 'Pulpit',
    elevation: 2170,
    latitude: 39.9143,
    longitude: -77.9583,
    orientation: 'SW-NNW',  // Launch faces WNW; flyable SW through NNW
    maxWind: 20,
    siteType: 'mixed',  // CHGPA site above McConnellsburg PA; difficult in N cross, rocks below/left of takeoff
    state: 'PA'
  },
  {
    id: 'bills-hill',
    name: "Bill's Hill",
    elevation: 1740,
    latitude: 40.10,
    longitude: -78.09,
    orientation: 'ENE-SE',  // East-facing ridge per CHGPA
    maxWind: 18,
    siteType: 'mixed',  // Buchanan State Forest, PA; contact forest office before each flight (CHGPA requirement)
    state: 'PA'
  },

  // --- Virginia (CHGPA) ---
  {
    id: 'ediths-gap',
    name: "Edith's Gap",
    elevation: 1650,
    latitude: 38.7253,
    longitude: -78.5079,
    orientation: 'E-SSE',  // USFS listing: faces SE, flyable E through SSE
    maxWind: 20,
    siteType: 'mixed',  // Massanutten SE slope near Luray VA; US Forest Service hang-gliding launch
    state: 'VA'
  },
  {
    id: 'woodstock',
    name: 'Woodstock',
    elevation: 1830,
    latitude: 38.8706,
    longitude: -78.4500,
    orientation: 'W-NW',  // Perched high on W slope of Massanutten; CHGPA: not good in W cross due to spine
    maxWind: 20,
    siteType: 'mixed',  // Massanutten W slope; Holfuy weather station on observation tower above launch
    state: 'VA'
  },
  {
    id: 'dickey-ridge',
    name: 'Dickey Ridge',
    elevation: 2430,
    latitude: 38.8547,
    longitude: -78.205,
    orientation: 'SW-W',  // SW-facing ridge inside Shenandoah NP
    maxWind: 18,
    siteType: 'mixed',  // Shenandoah NP; NPS permit required (P3+ with cliff-launch endorsement, yearly fee)
    state: 'VA'
  },
  {
    id: 'daniels',
    name: 'Daniels',
    elevation: 1620,
    latitude: 38.3108,
    longitude: -78.5117,
    orientation: 'S-SW',  // CHGPA: faces SSW, not good in W cross
    maxWind: 18,
    siteType: 'mixed',  // Near Stanardsville, VA
    state: 'VA'
  }
];
