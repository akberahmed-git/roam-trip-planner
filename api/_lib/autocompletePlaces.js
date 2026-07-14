// Server-side proxy for Google Places Autocomplete (New). Keeps the API key
// off the client, same pattern as verifyPlace.js and trendingLocations.js.
//
// When the user types a country name we return a curated top-5 city list
// rather than letting Google's Text Search return noise (national parks,
// museums, etc.). For city/partial input, normal Google Autocomplete runs.

// ── Top 5 cities per country ─────────────────────────────────────────────────
const COUNTRY_CITIES = {
  // A
  afghanistan: ['Kabul', 'Mazar-i-Sharif', 'Herat', 'Kandahar', 'Jalalabad'],
  albania: ['Tirana', 'Berat', 'Gjirokastër', 'Sarandë', 'Shkodër'],
  algeria: ['Algiers', 'Oran', 'Constantine', 'Annaba', 'Tlemcen'],
  andorra: ['Andorra la Vella', 'Escaldes-Engordany', 'Encamp', 'La Massana', 'Sant Julià de Lòria'],
  angola: ['Luanda', 'Lobito', 'Benguela', 'Lubango', 'Huambo'],
  argentina: ['Buenos Aires', 'Mendoza', 'Córdoba', 'Bariloche', 'Salta'],
  armenia: ['Yerevan', 'Gyumri', 'Vanadzor', 'Dilijan', 'Goris'],
  australia: ['Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Gold Coast'],
  austria: ['Vienna', 'Salzburg', 'Innsbruck', 'Graz', 'Hallstatt'],
  azerbaijan: ['Baku', 'Sheki', 'Ganja', 'Quba', 'Lankaran'],
  // B
  bahamas: ['Nassau', 'Freeport', 'Exuma', 'Harbour Island', 'Eleuthera'],
  bahrain: ['Manama', 'Muharraq', 'Riffa', 'Hamad Town', 'Isa Town'],
  bangladesh: ['Dhaka', 'Chittagong', 'Sylhet', 'Cox\'s Bazar', 'Khulna'],
  barbados: ['Bridgetown', 'Speightstown', 'Holetown', 'Oistins', 'Bathsheba'],
  belarus: ['Minsk', 'Brest', 'Grodno', 'Vitebsk', 'Gomel'],
  belgium: ['Brussels', 'Bruges', 'Ghent', 'Antwerp', 'Liège'],
  belize: ['Belize City', 'San Ignacio', 'Placencia', 'Ambergris Caye', 'Caye Caulker'],
  bhutan: ['Thimphu', 'Paro', 'Punakha', 'Bumthang', 'Wangdue Phodrang'],
  bolivia: ['La Paz', 'Sucre', 'Santa Cruz', 'Potosí', 'Cochabamba'],
  'bosnia and herzegovina': ['Sarajevo', 'Mostar', 'Banja Luka', 'Konjic', 'Trebinje'],
  botswana: ['Gaborone', 'Maun', 'Kasane', 'Francistown', 'Palapye'],
  brazil: ['Rio de Janeiro', 'São Paulo', 'Salvador', 'Florianópolis', 'Foz do Iguaçu'],
  brunei: ['Bandar Seri Begawan', 'Seria', 'Kuala Belait', 'Tutong', 'Bangar'],
  bulgaria: ['Sofia', 'Plovdiv', 'Varna', 'Veliko Tarnovo', 'Bansko'],
  'burkina faso': ['Ouagadougou', 'Bobo-Dioulasso', 'Koudougou', 'Banfora', 'Ouahigouya'],
  // C
  cambodia: ['Siem Reap', 'Phnom Penh', 'Sihanoukville', 'Battambang', 'Kampot'],
  cameroon: ['Yaoundé', 'Douala', 'Bafoussam', 'Bamenda', 'Kribi'],
  canada: ['Toronto', 'Vancouver', 'Montreal', 'Quebec City', 'Banff'],
  chile: ['Santiago', 'Valparaíso', 'San Pedro de Atacama', 'Puerto Natales', 'Pucón'],
  china: ['Beijing', 'Shanghai', 'Chengdu', 'Xi\'an', 'Guilin'],
  colombia: ['Cartagena', 'Medellín', 'Bogotá', 'Santa Marta', 'Cali'],
  'costa rica': ['San José', 'Manuel Antonio', 'La Fortuna', 'Tamarindo', 'Monteverde'],
  croatia: ['Dubrovnik', 'Split', 'Zagreb', 'Hvar', 'Rovinj'],
  cuba: ['Havana', 'Trinidad', 'Varadero', 'Cienfuegos', 'Santiago de Cuba'],
  cyprus: ['Paphos', 'Limassol', 'Nicosia', 'Larnaca', 'Ayia Napa'],
  czechia: ['Prague', 'Český Krumlov', 'Brno', 'Karlovy Vary', 'Olomouc'],
  'czech republic': ['Prague', 'Český Krumlov', 'Brno', 'Karlovy Vary', 'Olomouc'],
  // D
  denmark: ['Copenhagen', 'Aarhus', 'Odense', 'Aalborg', 'Helsingør'],
  'dominican republic': ['Punta Cana', 'Santo Domingo', 'Puerto Plata', 'Samaná', 'La Romana'],
  // E
  ecuador: ['Quito', 'Guayaquil', 'Cuenca', 'Baños', 'Puerto Ayora'],
  egypt: ['Cairo', 'Luxor', 'Aswan', 'Hurghada', 'Alexandria'],
  'el salvador': ['San Salvador', 'Santa Ana', 'Suchitoto', 'El Tunco', 'San Miguel'],
  estonia: ['Tallinn', 'Tartu', 'Pärnu', 'Narva', 'Haapsalu'],
  ethiopia: ['Addis Ababa', 'Lalibela', 'Gondar', 'Axum', 'Hawassa'],
  // F
  fiji: ['Nadi', 'Suva', 'Sigatoka', 'Lautoka', 'Savusavu'],
  finland: ['Helsinki', 'Rovaniemi', 'Turku', 'Tampere', 'Inari'],
  france: ['Paris', 'Nice', 'Lyon', 'Marseille', 'Bordeaux'],
  // G
  georgia: ['Tbilisi', 'Batumi', 'Kutaisi', 'Sighnaghi', 'Stepantsminda'],
  germany: ['Berlin', 'Munich', 'Hamburg', 'Cologne', 'Frankfurt'],
  ghana: ['Accra', 'Cape Coast', 'Kumasi', 'Tamale', 'Elmina'],
  greece: ['Athens', 'Santorini', 'Mykonos', 'Thessaloniki', 'Crete'],
  guatemala: ['Guatemala City', 'Antigua', 'Flores', 'Quetzaltenango', 'Panajachel'],
  // H
  haiti: ['Port-au-Prince', 'Cap-Haïtien', 'Jacmel', 'Les Cayes', 'Pétionville'],
  honduras: ['Tegucigalpa', 'San Pedro Sula', 'Roatán', 'La Ceiba', 'Copán Ruinas'],
  'hong kong': ['Hong Kong Island', 'Kowloon', 'Lantau Island', 'Mong Kok', 'Tsim Sha Tsui'],
  hungary: ['Budapest', 'Eger', 'Pécs', 'Debrecen', 'Győr'],
  // I
  iceland: ['Reykjavik', 'Akureyri', 'Vik', 'Húsavík', 'Stykkishólmur'],
  india: ['Mumbai', 'Delhi', 'Jaipur', 'Goa', 'Varanasi'],
  indonesia: ['Bali', 'Jakarta', 'Yogyakarta', 'Lombok', 'Labuan Bajo'],
  iran: ['Tehran', 'Isfahan', 'Shiraz', 'Yazd', 'Tabriz'],
  iraq: ['Baghdad', 'Erbil', 'Basra', 'Sulaymaniyah', 'Najaf'],
  ireland: ['Dublin', 'Galway', 'Cork', 'Kilkenny', 'Dingle'],
  israel: ['Tel Aviv', 'Jerusalem', 'Haifa', 'Eilat', 'Nazareth'],
  italy: ['Rome', 'Florence', 'Venice', 'Milan', 'Amalfi'],
  // J
  jamaica: ['Kingston', 'Montego Bay', 'Negril', 'Ocho Rios', 'Port Antonio'],
  japan: ['Tokyo', 'Kyoto', 'Osaka', 'Hiroshima', 'Nara'],
  jordan: ['Amman', 'Petra', 'Wadi Rum', 'Aqaba', 'Jerash'],
  // K
  kazakhstan: ['Almaty', 'Astana', 'Shymkent', 'Aktau', 'Turkestan'],
  kenya: ['Nairobi', 'Mombasa', 'Maasai Mara', 'Diani Beach', 'Lamu'],
  // L
  laos: ['Luang Prabang', 'Vientiane', 'Vang Vieng', 'Pakse', '4000 Islands'],
  latvia: ['Riga', 'Jūrmala', 'Sigulda', 'Cēsis', 'Liepāja'],
  lebanon: ['Beirut', 'Byblos', 'Sidon', 'Baalbek', 'Tyre'],
  lithuania: ['Vilnius', 'Kaunas', 'Trakai', 'Klaipėda', 'Palanga'],
  luxembourg: ['Luxembourg City', 'Echternach', 'Vianden', 'Mondorf-les-Bains', 'Clervaux'],
  // M
  madagascar: ['Antananarivo', 'Nosy Be', 'Morondava', 'Diego Suarez', 'Toamasina'],
  malaysia: ['Kuala Lumpur', 'Penang', 'Langkawi', 'Kota Kinabalu', 'Malacca'],
  maldives: ['Malé', 'Maafushi', 'Hulhumalé', 'Addu City', 'Fuvahmulah'],
  malta: ['Valletta', 'Mdina', 'Sliema', 'Gozo', 'Marsaxlokk'],
  mexico: ['Mexico City', 'Cancún', 'Oaxaca', 'Tulum', 'San Miguel de Allende'],
  moldova: ['Chișinău', 'Orheiul Vechi', 'Tiraspol', 'Cahul', 'Soroca'],
  monaco: ['Monaco', 'Monte Carlo', 'La Condamine', 'Fontvieille', 'Moneghetti'],
  mongolia: ['Ulaanbaatar', 'Karakorum', 'Ölgii', 'Dalanzadgad', 'Erdenet'],
  montenegro: ['Kotor', 'Budva', 'Podgorica', 'Cetinje', 'Herceg Novi'],
  morocco: ['Marrakech', 'Fes', 'Chefchaouen', 'Casablanca', 'Essaouira'],
  mozambique: ['Maputo', 'Vilankulo', 'Bazaruto', 'Beira', 'Pemba'],
  myanmar: ['Yangon', 'Bagan', 'Mandalay', 'Inle Lake', 'Ngapali'],
  // N
  namibia: ['Windhoek', 'Swakopmund', 'Sossusvlei', 'Etosha', 'Lüderitz'],
  nepal: ['Kathmandu', 'Pokhara', 'Chitwan', 'Nagarkot', 'Lumbini'],
  netherlands: ['Amsterdam', 'Rotterdam', 'The Hague', 'Utrecht', 'Haarlem'],
  'new zealand': ['Queenstown', 'Auckland', 'Rotorua', 'Wellington', 'Christchurch'],
  nicaragua: ['Managua', 'Granada', 'León', 'Ometepe', 'San Juan del Sur'],
  nigeria: ['Lagos', 'Abuja', 'Kano', 'Ibadan', 'Calabar'],
  norway: ['Oslo', 'Bergen', 'Tromsø', 'Flåm', 'Ålesund'],
  // O
  oman: ['Muscat', 'Salalah', 'Nizwa', 'Khasab', 'Sur'],
  // P
  pakistan: ['Lahore', 'Islamabad', 'Karachi', 'Peshawar', 'Hunza'],
  palestine: ['Jerusalem', 'Bethlehem', 'Ramallah', 'Jericho', 'Nablus'],
  panama: ['Panama City', 'Bocas del Toro', 'Boquete', 'Colón', 'Santa Catalina'],
  peru: ['Cusco', 'Lima', 'Arequipa', 'Machu Picchu', 'Puno'],
  philippines: ['Manila', 'Cebu City', 'Palawan', 'Boracay', 'Siargao'],
  poland: ['Kraków', 'Warsaw', 'Gdańsk', 'Wrocław', 'Zakopane'],
  portugal: ['Lisbon', 'Porto', 'Algarve', 'Sintra', 'Funchal'],
  // Q
  qatar: ['Doha', 'Lusail', 'Al Wakrah', 'Al Khor', 'Mesaieed'],
  // R
  romania: ['Bucharest', 'Brașov', 'Cluj-Napoca', 'Sibiu', 'Sinaia'],
  russia: ['Moscow', 'St. Petersburg', 'Kazan', 'Sochi', 'Vladivostok'],
  rwanda: ['Kigali', 'Musanze', 'Gisenyi', 'Butare', 'Nyungwe'],
  // S
  'saudi arabia': ['Riyadh', 'Jeddah', 'Mecca', 'Medina', 'AlUla'],
  senegal: ['Dakar', 'Saint-Louis', 'Saly', 'Ziguinchor', 'Touba'],
  serbia: ['Belgrade', 'Novi Sad', 'Niš', 'Subotica', 'Zlatibor'],
  singapore: ['Singapore'],
  slovakia: ['Bratislava', 'Košice', 'Banská Bystrica', 'Žilina', 'Prešov'],
  slovenia: ['Ljubljana', 'Bled', 'Piran', 'Maribor', 'Kranjska Gora'],
  'south africa': ['Cape Town', 'Johannesburg', 'Durban', 'Knysna', 'Stellenbosch'],
  'south korea': ['Seoul', 'Busan', 'Jeju', 'Gyeongju', 'Incheon'],
  spain: ['Barcelona', 'Madrid', 'Seville', 'Granada', 'San Sebastián'],
  'sri lanka': ['Colombo', 'Galle', 'Kandy', 'Sigiriya', 'Ella'],
  sweden: ['Stockholm', 'Gothenburg', 'Malmö', 'Uppsala', 'Kiruna'],
  switzerland: ['Zurich', 'Geneva', 'Lucerne', 'Interlaken', 'Zermatt'],
  // T
  taiwan: ['Taipei', 'Tainan', 'Kaohsiung', 'Hualien', 'Taichung'],
  tanzania: ['Zanzibar', 'Arusha', 'Serengeti', 'Dar es Salaam', 'Stone Town'],
  thailand: ['Bangkok', 'Chiang Mai', 'Phuket', 'Koh Samui', 'Krabi'],
  'timor-leste': ['Dili', 'Baucau', 'Suai', 'Maliana', 'Ermera'],
  tunisia: ['Tunis', 'Hammamet', 'Sousse', 'Djerba', 'Sidi Bou Said'],
  turkey: ['Istanbul', 'Cappadocia', 'Antalya', 'Bodrum', 'Pamukkale'],
  // U
  uganda: ['Kampala', 'Entebbe', 'Jinja', 'Fort Portal', 'Bwindi'],
  ukraine: ['Kyiv', 'Lviv', 'Odessa', 'Chernivtsi', 'Kharkiv'],
  'united arab emirates': ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ras Al Khaimah', 'Fujairah'],
  'united kingdom': ['London', 'Edinburgh', 'Manchester', 'Bath', 'Oxford'],
  'united states': ['New York', 'Los Angeles', 'Miami', 'Chicago', 'San Francisco'],
  uruguay: ['Montevideo', 'Punta del Este', 'Colonia del Sacramento', 'Cabo Polonio', 'Salto'],
  uzbekistan: ['Samarkand', 'Tashkent', 'Bukhara', 'Khiva', 'Fergana'],
  // V
  venezuela: ['Caracas', 'Mérida', 'Santa Elena de Uairén', 'Canaima', 'Margarita Island'],
  vietnam: ['Hanoi', 'Ho Chi Minh City', 'Hoi An', 'Da Nang', 'Halong Bay'],
  // Y
  yemen: ['Sana\'a', 'Aden', 'Socotra', 'Taiz', 'Mukalla'],
  // Z
  zambia: ['Lusaka', 'Livingstone', 'Kafue', 'Mfuwe', 'Ndola'],
  zimbabwe: ['Harare', 'Victoria Falls', 'Bulawayo', 'Hwange', 'Masvingo'],
  // Aliases
  usa: ['New York', 'Los Angeles', 'Miami', 'Chicago', 'San Francisco'],
  us: ['New York', 'Los Angeles', 'Miami', 'Chicago', 'San Francisco'],
  uk: ['London', 'Edinburgh', 'Manchester', 'Bath', 'Oxford'],
  uae: ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ras Al Khaimah', 'Fujairah'],
  england: ['London', 'Manchester', 'Bath', 'Oxford', 'Cambridge'],
  scotland: ['Edinburgh', 'Glasgow', 'Inverness', 'St Andrews', 'Fort William'],
  wales: ['Cardiff', 'Snowdonia', 'Brecon Beacons', 'Tenby', 'Hay-on-Wye'],
  bali: ['Seminyak', 'Ubud', 'Canggu', 'Uluwatu', 'Nusa Dua'],
  korea: ['Seoul', 'Busan', 'Jeju', 'Gyeongju', 'Incheon'],
  'ivory coast': ['Abidjan', 'Yamoussoukro', 'Bouaké', 'San-Pédro', 'Assinie'],
}

// Proper title-case for display (e.g. "united states" → "United States")
function toTitleCase(str) {
  const lowercase = ['and', 'of', 'the', 'in', 'de']
  return str
    .split(' ')
    .map((word, i) =>
      i === 0 || !lowercase.includes(word)
        ? word.charAt(0).toUpperCase() + word.slice(1)
        : word
    )
    .join(' ')
}

// ── Google Places Autocomplete ───────────────────────────────────────────────
// Standard city/region autocomplete. 'country' type excluded intentionally.
async function googleAutocomplete(input) {
  const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY,
    },
    body: JSON.stringify({
      input,
      includedPrimaryTypes: ['locality', 'administrative_area_level_1', 'sublocality'],
    }),
  })

  if (!res.ok) throw new Error('Autocomplete request failed with status ' + res.status)

  const data = await res.json()
  return (data.suggestions || [])
    .map((entry) => entry.placePrediction)
    .filter(Boolean)
    .map((prediction) => ({
      placeId: prediction.placeId,
      text: prediction.text?.text || '',
      matches: prediction.text?.matches || [],
    }))
    .filter((s) => s.text)
}

// ── Main export ──────────────────────────────────────────────────────────────
export async function fetchDestinationSuggestions(input) {
  const trimmed = input.trim()
  const key = trimmed.toLowerCase()

  const cities = COUNTRY_CITIES[key]
  if (cities) {
    const countryName = toTitleCase(trimmed)
    return cities.map((city) => ({
      placeId: null,
      text: city === countryName ? city : `${city}, ${countryName}`,
      matches: [],
    }))
  }

  return googleAutocomplete(trimmed)
}
