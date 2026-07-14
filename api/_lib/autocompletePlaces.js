// Server-side proxy for Google Places Autocomplete (New). Keeps the API key
// off the client, same pattern as verifyPlace.js and trendingLocations.js.
//
// When the user types a country name we return a curated top-5 city list
// rather than letting Google's Text Search return noise (national parks,
// museums, etc.). For city/partial input, normal Google Autocomplete runs.

// ── Top 5 cities per country (all UN members + key territories) ──────────────
const COUNTRY_CITIES = {
  // A
  afghanistan: ['Kabul', 'Mazar-i-Sharif', 'Herat', 'Kandahar', 'Jalalabad'],
  albania: ['Tirana', 'Berat', 'Gjirokastër', 'Sarandë', 'Shkodër'],
  algeria: ['Algiers', 'Oran', 'Constantine', 'Annaba', 'Tlemcen'],
  andorra: ['Andorra la Vella', 'Escaldes-Engordany', 'Encamp', 'La Massana', 'Sant Julià de Lòria'],
  angola: ['Luanda', 'Lobito', 'Benguela', 'Lubango', 'Huambo'],
  'antigua and barbuda': ['Saint John\'s', 'Codrington', 'Liberta', 'All Saints', 'Bolans'],
  argentina: ['Buenos Aires', 'Mendoza', 'Córdoba', 'Bariloche', 'Salta'],
  armenia: ['Yerevan', 'Gyumri', 'Vanadzor', 'Dilijan', 'Goris'],
  australia: ['Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Gold Coast'],
  austria: ['Vienna', 'Salzburg', 'Innsbruck', 'Graz', 'Hallstatt'],
  azerbaijan: ['Baku', 'Sheki', 'Ganja', 'Quba', 'Lankaran'],
  // B
  bahamas: ['Nassau', 'Freeport', 'Exuma', 'Harbour Island', 'Eleuthera'],
  bahrain: ['Manama', 'Muharraq', 'Riffa', 'Hamad Town', 'Isa Town'],
  bangladesh: ['Dhaka', 'Chittagong', 'Sylhet', "Cox's Bazar", 'Khulna'],
  barbados: ['Bridgetown', 'Speightstown', 'Holetown', 'Oistins', 'Bathsheba'],
  belarus: ['Minsk', 'Brest', 'Grodno', 'Vitebsk', 'Gomel'],
  belgium: ['Brussels', 'Bruges', 'Ghent', 'Antwerp', 'Liège'],
  belize: ['Belize City', 'San Ignacio', 'Placencia', 'Ambergris Caye', 'Caye Caulker'],
  benin: ['Cotonou', 'Porto-Novo', 'Parakou', 'Ouidah', 'Abomey'],
  bhutan: ['Thimphu', 'Paro', 'Punakha', 'Bumthang', 'Wangdue Phodrang'],
  bolivia: ['La Paz', 'Sucre', 'Santa Cruz', 'Potosí', 'Cochabamba'],
  'bosnia and herzegovina': ['Sarajevo', 'Mostar', 'Banja Luka', 'Konjic', 'Trebinje'],
  botswana: ['Gaborone', 'Maun', 'Kasane', 'Francistown', 'Palapye'],
  brazil: ['Rio de Janeiro', 'São Paulo', 'Salvador', 'Florianópolis', 'Foz do Iguaçu'],
  brunei: ['Bandar Seri Begawan', 'Seria', 'Kuala Belait', 'Tutong', 'Bangar'],
  bulgaria: ['Sofia', 'Plovdiv', 'Varna', 'Veliko Tarnovo', 'Bansko'],
  'burkina faso': ['Ouagadougou', 'Bobo-Dioulasso', 'Koudougou', 'Banfora', 'Ouahigouya'],
  burundi: ['Bujumbura', 'Gitega', 'Ngozi', 'Rumonge', 'Muyinga'],
  // C
  'cabo verde': ['Praia', 'Mindelo', 'Santa Maria', 'Espargos', 'Assomada'],
  'cape verde': ['Praia', 'Mindelo', 'Santa Maria', 'Espargos', 'Assomada'],
  cambodia: ['Siem Reap', 'Phnom Penh', 'Sihanoukville', 'Battambang', 'Kampot'],
  cameroon: ['Yaoundé', 'Douala', 'Bafoussam', 'Bamenda', 'Kribi'],
  canada: ['Toronto', 'Vancouver', 'Montreal', 'Quebec City', 'Banff'],
  'central african republic': ['Bangui', 'Bimbo', 'Mbaïki', 'Berberati', 'Carnot'],
  chad: ["N'Djamena", 'Moundou', 'Sarh', 'Abéché', 'Kélo'],
  chile: ['Santiago', 'Valparaíso', 'San Pedro de Atacama', 'Puerto Natales', 'Pucón'],
  china: ['Beijing', 'Shanghai', 'Chengdu', "Xi'an", 'Guilin'],
  colombia: ['Cartagena', 'Medellín', 'Bogotá', 'Santa Marta', 'Cali'],
  comoros: ['Moroni', 'Mutsamudu', 'Domoni', 'Fomboni', 'Tsimbeo'],
  congo: ['Brazzaville', 'Pointe-Noire', 'Dolisie', 'Impfondo', 'Ouesso'],
  'democratic republic of the congo': ['Kinshasa', 'Lubumbashi', 'Goma', 'Kisangani', 'Bukavu'],
  'dr congo': ['Kinshasa', 'Lubumbashi', 'Goma', 'Kisangani', 'Bukavu'],
  'costa rica': ['San José', 'Manuel Antonio', 'La Fortuna', 'Tamarindo', 'Monteverde'],
  croatia: ['Dubrovnik', 'Split', 'Zagreb', 'Hvar', 'Rovinj'],
  cuba: ['Havana', 'Trinidad', 'Varadero', 'Cienfuegos', 'Santiago de Cuba'],
  cyprus: ['Paphos', 'Limassol', 'Nicosia', 'Larnaca', 'Ayia Napa'],
  czechia: ['Prague', 'Český Krumlov', 'Brno', 'Karlovy Vary', 'Olomouc'],
  'czech republic': ['Prague', 'Český Krumlov', 'Brno', 'Karlovy Vary', 'Olomouc'],
  // D
  denmark: ['Copenhagen', 'Aarhus', 'Odense', 'Aalborg', 'Helsingør'],
  djibouti: ['Djibouti City', 'Tadjourah', 'Obock', 'Dikhil', 'Ali Sabieh'],
  dominica: ['Roseau', 'Portsmouth', 'Marigot', 'La Plaine', 'Castle Bruce'],
  'dominican republic': ['Punta Cana', 'Santo Domingo', 'Puerto Plata', 'Samaná', 'La Romana'],
  // E
  ecuador: ['Quito', 'Guayaquil', 'Cuenca', 'Baños', 'Puerto Ayora'],
  egypt: ['Cairo', 'Luxor', 'Aswan', 'Hurghada', 'Alexandria'],
  'el salvador': ['San Salvador', 'Santa Ana', 'Suchitoto', 'El Tunco', 'San Miguel'],
  'equatorial guinea': ['Malabo', 'Bata', 'Ebebiyin', 'Aconibe', 'Añisoc'],
  eritrea: ['Asmara', 'Massawa', 'Keren', 'Assab', 'Mendefera'],
  estonia: ['Tallinn', 'Tartu', 'Pärnu', 'Narva', 'Haapsalu'],
  eswatini: ['Mbabane', 'Manzini', 'Lobamba', 'Siteki', 'Nhlangano'],
  ethiopia: ['Addis Ababa', 'Lalibela', 'Gondar', 'Axum', 'Hawassa'],
  // F
  fiji: ['Nadi', 'Suva', 'Sigatoka', 'Lautoka', 'Savusavu'],
  finland: ['Helsinki', 'Rovaniemi', 'Turku', 'Tampere', 'Inari'],
  france: ['Paris', 'Nice', 'Lyon', 'Marseille', 'Bordeaux'],
  // G
  gabon: ['Libreville', 'Port-Gentil', 'Franceville', 'Oyem', 'Moanda'],
  gambia: ['Banjul', 'Serekunda', 'Brikama', 'Bakau', 'Kololi'],
  georgia: ['Tbilisi', 'Batumi', 'Kutaisi', 'Sighnaghi', 'Stepantsminda'],
  germany: ['Berlin', 'Munich', 'Hamburg', 'Cologne', 'Frankfurt'],
  ghana: ['Accra', 'Cape Coast', 'Kumasi', 'Tamale', 'Elmina'],
  greece: ['Athens', 'Santorini', 'Mykonos', 'Thessaloniki', 'Crete'],
  grenada: ["St. George's", 'Grenville', 'Gouyave', 'Victoria', 'Sauteurs'],
  guatemala: ['Guatemala City', 'Antigua', 'Flores', 'Quetzaltenango', 'Panajachel'],
  'guinea-bissau': ['Bissau', 'Bafatá', 'Gabú', 'Bissorã', 'Bolama'],
  guinea: ['Conakry', 'Nzérékoré', 'Kindia', 'Labé', 'Kankan'],
  guyana: ['Georgetown', 'Linden', 'New Amsterdam', 'Anna Regina', 'Bartica'],
  // H
  haiti: ['Port-au-Prince', 'Cap-Haïtien', 'Jacmel', 'Les Cayes', 'Pétionville'],
  honduras: ['Tegucigalpa', 'San Pedro Sula', 'Roatán', 'La Ceiba', 'Copán Ruinas'],
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
  'ivory coast': ['Abidjan', 'Yamoussoukro', 'Bouaké', 'San-Pédro', 'Assinie'],
  "côte d'ivoire": ['Abidjan', 'Yamoussoukro', 'Bouaké', 'San-Pédro', 'Assinie'],
  // J
  jamaica: ['Kingston', 'Montego Bay', 'Negril', 'Ocho Rios', 'Port Antonio'],
  japan: ['Tokyo', 'Kyoto', 'Osaka', 'Hiroshima', 'Nara'],
  jordan: ['Amman', 'Petra', 'Wadi Rum', 'Aqaba', 'Jerash'],
  // K
  kazakhstan: ['Almaty', 'Astana', 'Shymkent', 'Aktau', 'Turkestan'],
  kenya: ['Nairobi', 'Mombasa', 'Maasai Mara', 'Diani Beach', 'Lamu'],
  kiribati: ['South Tarawa', 'Betio', 'Bikenibeu', 'Bairiki', 'Abemama'],
  kosovo: ['Pristina', 'Prizren', 'Peja', 'Gjakova', 'Mitrovica'],
  kuwait: ['Kuwait City', 'Salmiya', 'Hawalli', 'Farwaniya', 'Ahmadi'],
  kyrgyzstan: ['Bishkek', 'Osh', 'Karakol', 'Jalal-Abad', 'Naryn'],
  // L
  laos: ['Luang Prabang', 'Vientiane', 'Vang Vieng', 'Pakse', '4000 Islands'],
  latvia: ['Riga', 'Jūrmala', 'Sigulda', 'Cēsis', 'Liepāja'],
  lebanon: ['Beirut', 'Byblos', 'Sidon', 'Baalbek', 'Tyre'],
  lesotho: ['Maseru', 'Teyateyaneng', 'Mafeteng', 'Hlotse', 'Mohale\'s Hoek'],
  liberia: ['Monrovia', 'Gbarnga', 'Kakata', 'Bensonville', 'Harper'],
  libya: ['Tripoli', 'Benghazi', 'Misrata', 'Sabha', 'Tobruk'],
  liechtenstein: ['Vaduz', 'Schaan', 'Balzers', 'Triesen', 'Eschen'],
  lithuania: ['Vilnius', 'Kaunas', 'Trakai', 'Klaipėda', 'Palanga'],
  luxembourg: ['Luxembourg City', 'Echternach', 'Vianden', 'Mondorf-les-Bains', 'Clervaux'],
  // M
  madagascar: ['Antananarivo', 'Nosy Be', 'Morondava', 'Diego Suarez', 'Toamasina'],
  malawi: ['Lilongwe', 'Blantyre', 'Mzuzu', 'Zomba', 'Nkhata Bay'],
  malaysia: ['Kuala Lumpur', 'Penang', 'Langkawi', 'Kota Kinabalu', 'Malacca'],
  maldives: ['Malé', 'Maafushi', 'Hulhumalé', 'Addu City', 'Fuvahmulah'],
  mali: ['Bamako', 'Timbuktu', 'Djenné', 'Mopti', 'Ségou'],
  malta: ['Valletta', 'Mdina', 'Sliema', 'Gozo', 'Marsaxlokk'],
  'marshall islands': ['Majuro', 'Ebeye', 'Jaluit', 'Wotje', 'Mili'],
  mauritania: ['Nouakchott', 'Nouadhibou', 'Rosso', 'Atar', 'Chinguetti'],
  mauritius: ['Port Louis', 'Grand Baie', 'Flic en Flac', 'Mahébourg', 'Trou aux Biches'],
  mexico: ['Mexico City', 'Cancún', 'Oaxaca', 'Tulum', 'San Miguel de Allende'],
  micronesia: ['Palikir', 'Weno', 'Kolonia', 'Tofol', 'Colonia'],
  moldova: ['Chișinău', 'Orheiul Vechi', 'Tiraspol', 'Cahul', 'Soroca'],
  monaco: ['Monaco', 'Monte Carlo', 'La Condamine', 'Fontvieille', 'Moneghetti'],
  mongolia: ['Ulaanbaatar', 'Karakorum', 'Ölgii', 'Dalanzadgad', 'Erdenet'],
  montenegro: ['Kotor', 'Budva', 'Podgorica', 'Cetinje', 'Herceg Novi'],
  morocco: ['Marrakech', 'Fes', 'Chefchaouen', 'Casablanca', 'Essaouira'],
  mozambique: ['Maputo', 'Vilankulo', 'Bazaruto', 'Beira', 'Pemba'],
  myanmar: ['Yangon', 'Bagan', 'Mandalay', 'Inle Lake', 'Ngapali'],
  // N
  namibia: ['Windhoek', 'Swakopmund', 'Sossusvlei', 'Etosha', 'Lüderitz'],
  nauru: ['Yaren', 'Aiwo', 'Anabar', 'Anetan', 'Anibare'],
  nepal: ['Kathmandu', 'Pokhara', 'Chitwan', 'Nagarkot', 'Lumbini'],
  netherlands: ['Amsterdam', 'Rotterdam', 'The Hague', 'Utrecht', 'Haarlem'],
  'new zealand': ['Queenstown', 'Auckland', 'Rotorua', 'Wellington', 'Christchurch'],
  nicaragua: ['Managua', 'Granada', 'León', 'Ometepe', 'San Juan del Sur'],
  niger: ['Niamey', 'Zinder', 'Maradi', 'Tahoua', 'Agadez'],
  nigeria: ['Lagos', 'Abuja', 'Kano', 'Ibadan', 'Calabar'],
  'north korea': ['Pyongyang', 'Kaesong', 'Wonsan', 'Hamhung', 'Chongjin'],
  'north macedonia': ['Skopje', 'Ohrid', 'Bitola', 'Tetovo', 'Mavrovo'],
  norway: ['Oslo', 'Bergen', 'Tromsø', 'Flåm', 'Ålesund'],
  // O
  oman: ['Muscat', 'Salalah', 'Nizwa', 'Khasab', 'Sur'],
  // P
  pakistan: ['Lahore', 'Islamabad', 'Karachi', 'Peshawar', 'Hunza'],
  palau: ['Ngerulmud', 'Koror', 'Airai', 'Melekeok', 'Peleliu'],
  palestine: ['Bethlehem', 'Ramallah', 'Jericho', 'Nablus', 'Hebron'],
  panama: ['Panama City', 'Bocas del Toro', 'Boquete', 'Colón', 'Santa Catalina'],
  'papua new guinea': ['Port Moresby', 'Lae', 'Mount Hagen', 'Goroka', 'Madang'],
  paraguay: ['Asunción', 'Ciudad del Este', 'Encarnación', 'Luque', 'San Lorenzo'],
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
  'saint kitts and nevis': ['Basseterre', 'Charlestown', 'Sandy Point Town', 'Cayon', 'Old Road Town'],
  'saint lucia': ['Castries', 'Soufrière', 'Gros Islet', 'Vieux Fort', 'Marigot Bay'],
  'saint vincent and the grenadines': ['Kingstown', 'Georgetown', 'Layou', 'Bequia', 'Mustique'],
  samoa: ['Apia', 'Salelologa', 'Falefa', 'Leulumoega', 'Mulifanua'],
  'san marino': ['San Marino City', 'Serravalle', 'Borgo Maggiore', 'Domagnano', 'Fiorentino'],
  'sao tome and principe': ['São Tomé', 'Santo António', 'Neves', 'Santana', 'Trindade'],
  'saudi arabia': ['Riyadh', 'Jeddah', 'Mecca', 'Medina', 'AlUla'],
  senegal: ['Dakar', 'Saint-Louis', 'Saly', 'Ziguinchor', 'Touba'],
  serbia: ['Belgrade', 'Novi Sad', 'Niš', 'Subotica', 'Zlatibor'],
  seychelles: ['Victoria', 'Beau Vallon', 'Anse Lazio', 'La Digue', 'Praslin'],
  'sierra leone': ['Freetown', 'Bo', 'Kenema', 'Makeni', 'Koidu'],
  singapore: ['Singapore', 'Orchard Road', 'Marina Bay', 'Sentosa', 'Chinatown'],
  slovakia: ['Bratislava', 'Košice', 'Banská Bystrica', 'Žilina', 'Prešov'],
  slovenia: ['Ljubljana', 'Bled', 'Piran', 'Maribor', 'Kranjska Gora'],
  'solomon islands': ['Honiara', 'Auki', 'Gizo', 'Tulagi', 'Kirakira'],
  somalia: ['Mogadishu', 'Hargeisa', 'Berbera', 'Bosaso', 'Kismayo'],
  'south africa': ['Cape Town', 'Johannesburg', 'Durban', 'Knysna', 'Stellenbosch'],
  'south korea': ['Seoul', 'Busan', 'Jeju', 'Gyeongju', 'Incheon'],
  'south sudan': ['Juba', 'Wau', 'Malakal', 'Yei', 'Torit'],
  spain: ['Barcelona', 'Madrid', 'Seville', 'Granada', 'San Sebastián'],
  'sri lanka': ['Colombo', 'Galle', 'Kandy', 'Sigiriya', 'Ella'],
  sudan: ['Khartoum', 'Omdurman', 'Port Sudan', 'Kassala', 'Juba'],
  suriname: ['Paramaribo', 'Lelydorp', 'Nieuw Nickerie', 'Moengo', 'Albina'],
  sweden: ['Stockholm', 'Gothenburg', 'Malmö', 'Uppsala', 'Kiruna'],
  switzerland: ['Zurich', 'Geneva', 'Lucerne', 'Interlaken', 'Zermatt'],
  syria: ['Damascus', 'Aleppo', 'Palmyra', 'Latakia', 'Homs'],
  // T
  taiwan: ['Taipei', 'Tainan', 'Kaohsiung', 'Hualien', 'Taichung'],
  tajikistan: ['Dushanbe', 'Khujand', 'Kulob', 'Qurghonteppa', 'Istaravshan'],
  tanzania: ['Zanzibar', 'Arusha', 'Serengeti', 'Dar es Salaam', 'Stone Town'],
  thailand: ['Bangkok', 'Chiang Mai', 'Phuket', 'Koh Samui', 'Krabi'],
  'timor-leste': ['Dili', 'Baucau', 'Suai', 'Maliana', 'Ermera'],
  togo: ['Lomé', 'Sokodé', 'Kara', 'Atakpamé', 'Kpalimé'],
  tonga: ["Nuku'alofa", 'Neiafu', 'Haapai', 'Pangai', 'Ohonua'],
  'trinidad and tobago': ['Port of Spain', 'San Fernando', 'Tobago', 'Chaguanas', 'Arima'],
  tunisia: ['Tunis', 'Hammamet', 'Sousse', 'Djerba', 'Sidi Bou Said'],
  turkey: ['Istanbul', 'Cappadocia', 'Antalya', 'Bodrum', 'Pamukkale'],
  turkmenistan: ['Ashgabat', 'Türkmenabat', 'Daşoguz', 'Mary', 'Balkanabat'],
  tuvalu: ['Funafuti', 'Fongafale', 'Alapi', 'Senala', 'Asau'],
  // U
  uganda: ['Kampala', 'Entebbe', 'Jinja', 'Fort Portal', 'Bwindi'],
  ukraine: ['Kyiv', 'Lviv', 'Odessa', 'Chernivtsi', 'Kharkiv'],
  'united arab emirates': ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ras Al Khaimah', 'Fujairah'],
  'united kingdom': ['London', 'Edinburgh', 'Manchester', 'Bath', 'Oxford'],
  'united states': ['New York', 'Los Angeles', 'Miami', 'Chicago', 'San Francisco'],
  uruguay: ['Montevideo', 'Punta del Este', 'Colonia del Sacramento', 'Cabo Polonio', 'Salto'],
  uzbekistan: ['Samarkand', 'Tashkent', 'Bukhara', 'Khiva', 'Fergana'],
  // V
  vanuatu: ['Port Vila', 'Luganville', 'Isangel', 'Sola', 'Lakatoro'],
  venezuela: ['Caracas', 'Mérida', 'Santa Elena de Uairén', 'Canaima', 'Margarita Island'],
  vietnam: ['Hanoi', 'Ho Chi Minh City', 'Hoi An', 'Da Nang', 'Halong Bay'],
  // Y
  yemen: ["Sana'a", 'Aden', 'Socotra', 'Taiz', 'Mukalla'],
  // Z
  zambia: ['Lusaka', 'Livingstone', 'Kafue', 'Mfuwe', 'Ndola'],
  zimbabwe: ['Harare', 'Victoria Falls', 'Bulawayo', 'Hwange', 'Masvingo'],

  // ── Common aliases ──────────────────────────────────────────────────────────
  usa: ['New York', 'Los Angeles', 'Miami', 'Chicago', 'San Francisco'],
  us: ['New York', 'Los Angeles', 'Miami', 'Chicago', 'San Francisco'],
  'united states of america': ['New York', 'Los Angeles', 'Miami', 'Chicago', 'San Francisco'],
  uk: ['London', 'Edinburgh', 'Manchester', 'Bath', 'Oxford'],
  'great britain': ['London', 'Edinburgh', 'Manchester', 'Bath', 'Oxford'],
  britain: ['London', 'Edinburgh', 'Manchester', 'Bath', 'Oxford'],
  uae: ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ras Al Khaimah', 'Fujairah'],
  england: ['London', 'Manchester', 'Bath', 'Oxford', 'Cambridge'],
  scotland: ['Edinburgh', 'Glasgow', 'Inverness', 'St Andrews', 'Fort William'],
  wales: ['Cardiff', 'Snowdonia', 'Brecon Beacons', 'Tenby', 'Hay-on-Wye'],
  'northern ireland': ['Belfast', 'Derry', 'Giant\'s Causeway', 'Enniskillen', 'Armagh'],
  bali: ['Seminyak', 'Ubud', 'Canggu', 'Uluwatu', 'Nusa Dua'],
  korea: ['Seoul', 'Busan', 'Jeju', 'Gyeongju', 'Incheon'],
  'hong kong': ['Kowloon', 'Central', 'Mong Kok', 'Lantau Island', 'Tsim Sha Tsui'],
  macau: ['Macau Peninsula', 'Taipa', 'Cotai', 'Coloane', 'Historic Centre'],
  'puerto rico': ['San Juan', 'Ponce', 'Rincón', 'Vieques', 'Fajardo'],
  kosovo: ['Pristina', 'Prizren', 'Peja', 'Gjakova', 'Mitrovica'],
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
    return cities.map((city) => {
      const text = city === countryName ? city : `${city}, ${countryName}`
      // Find where the typed input appears in the result so HighlightedText
      // can bold it — same format Google uses: startOffset/endOffset.
      const lowerText = text.toLowerCase()
      const matchStart = lowerText.indexOf(key)
      const matches =
        matchStart >= 0
          ? [{ startOffset: matchStart, endOffset: matchStart + key.length }]
          : []
      return { placeId: null, text, matches }
    })
  }

  return googleAutocomplete(trimmed)
}
