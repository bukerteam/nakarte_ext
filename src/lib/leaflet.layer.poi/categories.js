/* eslint-disable camelcase -- OSM tag keys are snake_case */
/*
 Catalog of OSM POI categories.

 A category matches an OSM element when at least one of its filters matches. A filter is an object
 mapping a tag key to an expected value (or to a list of expected values); all keys of a filter must
 match. `icon` is either 'carto:<path>' (openstreetmap-carto/symbols) or 'maki:<name>' (mapbox/maki),
 icons are resolved in icons.js. Categories without their own icon use the fallback icon.
 `minZoom` is inherited from the group when not set on the category.
 */
const poiGroups = [
    {
        id: 'water',
        titleRu: 'Вода',
        titleEn: 'Water',
        minZoom: 12,
        categories: [
            {
                id: 'drinking_water',
                titleRu: 'Питьевая вода',
                titleEn: 'Drinking water',
                filters: [{amenity: 'drinking_water'}],
                icon: 'carto:amenity/drinking_water.svg',
            },
            {
                id: 'spring',
                titleRu: 'Родник, источник',
                titleEn: 'Spring',
                filters: [{natural: 'spring'}],
                icon: 'carto:natural/spring.svg',
                minZoom: 11,
            },
            {
                id: 'water_point',
                titleRu: 'Точка забора воды',
                titleEn: 'Water point',
                filters: [{waterway: 'water_point'}, {amenity: 'water_point'}],
                icon: 'maki:water',
            },
            {
                id: 'watering_place',
                titleRu: 'Водопой',
                titleEn: 'Watering place',
                filters: [{amenity: 'watering_place'}],
            },
            {id: 'water_well', titleRu: 'Колодец', titleEn: 'Water well', filters: [{man_made: 'water_well'}]},
            {id: 'water_tap', titleRu: 'Водоразборный кран', titleEn: 'Water tap', filters: [{man_made: 'water_tap'}]},
            {
                id: 'hot_spring',
                titleRu: 'Горячий источник',
                titleEn: 'Hot spring',
                filters: [{natural: 'hot_spring'}],
                icon: 'maki:hot-spring',
                minZoom: 11,
            },
            {id: 'geyser', titleRu: 'Гейзер', titleEn: 'Geyser', filters: [{natural: 'geyser'}], minZoom: 11},
            {
                id: 'waterfall',
                titleRu: 'Водопад',
                titleEn: 'Waterfall',
                filters: [{waterway: 'waterfall'}],
                icon: 'carto:natural/waterfall.svg',
                minZoom: 11,
            },
            {
                id: 'fountain',
                titleRu: 'Фонтан',
                titleEn: 'Fountain',
                filters: [{amenity: 'fountain'}],
                icon: 'carto:amenity/fountain.svg',
            },
            {id: 'shower', titleRu: 'Душ', titleEn: 'Shower', filters: [{amenity: 'shower'}]},
            {
                id: 'water_tank',
                titleRu: 'Пожарный резервуар',
                titleEn: 'Water tank',
                filters: [{emergency: 'water_tank'}],
            },
            {
                id: 'beach',
                titleRu: 'Пляж, купальня',
                titleEn: 'Beach',
                filters: [{natural: 'beach'}, {leisure: ['swimming_area', 'beach_resort']}],
                icon: 'carto:leisure/beach_resort.svg',
                minZoom: 11,
            },
        ],
    },
    {
        id: 'camping',
        titleRu: 'Ночлег и кемпинг',
        titleEn: 'Camping and lodging',
        minZoom: 12,
        categories: [
            {
                id: 'camp_site',
                titleRu: 'Кемпинг',
                titleEn: 'Campsite',
                filters: [{tourism: 'camp_site'}],
                icon: 'carto:tourism/camping.svg',
                minZoom: 11,
            },
            {id: 'camp_pitch', titleRu: 'Место под палатку', titleEn: 'Camp pitch', filters: [{tourism: 'camp_pitch'}]},
            {
                id: 'caravan_site',
                titleRu: 'Кемпинг для автодомов',
                titleEn: 'Caravan site',
                filters: [{tourism: 'caravan_site'}],
                minZoom: 11,
            },
            {
                id: 'alpine_hut',
                titleRu: 'Альпийский домик',
                titleEn: 'Alpine hut',
                filters: [{tourism: 'alpine_hut'}],
                icon: 'carto:tourism/alpinehut.svg',
                minZoom: 11,
            },
            {
                id: 'wilderness_hut',
                titleRu: 'Дикий домик, изба',
                titleEn: 'Wilderness hut',
                filters: [{tourism: 'wilderness_hut'}],
                icon: 'carto:tourism/wilderness_hut.svg',
                minZoom: 11,
            },
            {id: 'lean_to', titleRu: 'Навес, шалаш', titleEn: 'Lean-to', filters: [{tourism: 'lean_to'}], minZoom: 11},
            {
                id: 'shelter',
                titleRu: 'Укрытие, навес',
                titleEn: 'Shelter',
                filters: [{amenity: 'shelter'}],
                icon: 'carto:amenity/shelter.svg',
                minZoom: 11,
            },
            {
                id: 'hunting_lodge',
                titleRu: 'Охотничий домик',
                titleEn: 'Hunting lodge',
                filters: [{tourism: 'hunting_lodge'}],
            },
            {
                id: 'guest_house',
                titleRu: 'Гостевой дом',
                titleEn: 'Guest house',
                filters: [{tourism: 'guest_house'}],
                minZoom: 13,
            },
            {id: 'hostel', titleRu: 'Хостел', titleEn: 'Hostel', filters: [{tourism: 'hostel'}], minZoom: 13},
            {
                id: 'hotel',
                titleRu: 'Отель, мотель, шале, апартаменты',
                titleEn: 'Hotel, motel, chalet, apartment',
                filters: [{tourism: ['hotel', 'motel', 'chalet', 'apartment']}],
                minZoom: 13,
            },
            {
                id: 'firepit',
                titleRu: 'Костровище',
                titleEn: 'Firepit',
                filters: [{leisure: 'firepit'}],
                icon: 'carto:leisure/firepit.svg',
            },
            {
                id: 'bbq',
                titleRu: 'Мангал, барбекю',
                titleEn: 'BBQ',
                filters: [{amenity: 'bbq'}],
                icon: 'carto:amenity/bbq.svg',
            },
            {
                id: 'picnic_site',
                titleRu: 'Место пикника',
                titleEn: 'Picnic site',
                filters: [{tourism: 'picnic_site'}, {leisure: 'picnic_table'}],
                icon: 'maki:picnic-site',
            },
        ],
    },
    {
        id: 'food',
        titleRu: 'Еда и магазины',
        titleEn: 'Food and shops',
        minZoom: 14,
        categories: [
            {
                id: 'groceries',
                titleRu: 'Продукты',
                titleEn: 'Groceries',
                filters: [{shop: ['convenience', 'supermarket', 'greengrocer', 'general', 'farm']}],
                icon: 'carto:shop/supermarket.svg',
            },
            {
                id: 'bakery',
                titleRu: 'Пекарня',
                titleEn: 'Bakery',
                filters: [{shop: ['bakery', 'pastry', 'confectionery']}],
                icon: 'maki:bakery',
            },
            {
                id: 'butcher',
                titleRu: 'Мясо, рыба, сыр, деликатесы',
                titleEn: 'Meat, fish, cheese, deli',
                filters: [{shop: ['butcher', 'seafood', 'cheese', 'deli', 'dairy']}],
            },
            {
                id: 'beverages',
                titleRu: 'Напитки, алкоголь',
                titleEn: 'Beverages, alcohol',
                filters: [{shop: ['beverages', 'alcohol', 'wine', 'coffee', 'tea']}],
                icon: 'maki:alcohol-shop',
            },
            {id: 'cafe', titleRu: 'Кафе', titleEn: 'Cafe', filters: [{amenity: 'cafe'}], icon: 'maki:cafe'},
            {
                id: 'restaurant',
                titleRu: 'Ресторан, фастфуд',
                titleEn: 'Restaurant, fast food',
                filters: [{amenity: ['restaurant', 'fast_food']}],
                icon: 'maki:restaurant',
            },
            {
                id: 'bar',
                titleRu: 'Бар, паб, биргартен',
                titleEn: 'Bar, pub, biergarten',
                filters: [{amenity: ['bar', 'pub', 'biergarten']}],
                icon: 'maki:bar',
            },
            {id: 'ice_cream', titleRu: 'Мороженое', titleEn: 'Ice cream', filters: [{amenity: 'ice_cream'}]},
            {id: 'kiosk', titleRu: 'Киоск', titleEn: 'Kiosk', filters: [{shop: 'kiosk'}]},
            {
                id: 'marketplace',
                titleRu: 'Рынок',
                titleEn: 'Marketplace',
                filters: [{amenity: 'marketplace'}],
                icon: 'carto:shop/marketplace.svg',
                minZoom: 13,
            },
            {
                id: 'outdoor',
                titleRu: 'Турснаряжение, спорт',
                titleEn: 'Outdoor, sports',
                filters: [{shop: ['outdoor', 'sports']}],
            },
            {
                id: 'bicycle_shop',
                titleRu: 'Веломагазин',
                titleEn: 'Bicycle shop',
                filters: [{shop: 'bicycle'}],
                icon: 'carto:shop/bicycle.svg',
                minZoom: 13,
            },
            {
                id: 'hardware',
                titleRu: 'Хозтовары, DIY',
                titleEn: 'Hardware, DIY',
                filters: [{shop: ['hardware', 'doityourself']}],
            },
        ],
    },
    {
        id: 'transport',
        titleRu: 'Транспорт',
        titleEn: 'Transport',
        minZoom: 13,
        categories: [
            {
                id: 'fuel',
                titleRu: 'АЗС',
                titleEn: 'Fuel',
                filters: [{amenity: 'fuel'}],
                icon: 'carto:amenity/fuel.svg',
                minZoom: 12,
            },
            {
                id: 'charging_station',
                titleRu: 'Зарядка электромобилей',
                titleEn: 'Charging station',
                filters: [{amenity: 'charging_station'}],
                icon: 'carto:amenity/charging_station.svg',
            },
            {
                id: 'parking',
                titleRu: 'Парковка',
                titleEn: 'Parking',
                filters: [{amenity: 'parking'}],
                icon: 'carto:amenity/parking.svg',
            },
            {
                id: 'bicycle_parking',
                titleRu: 'Велопарковка',
                titleEn: 'Bicycle parking',
                filters: [{amenity: 'bicycle_parking'}],
                icon: 'carto:amenity/bicycle_parking.svg',
            },
            {
                id: 'bicycle_rental',
                titleRu: 'Велопрокат',
                titleEn: 'Bicycle rental',
                filters: [{amenity: 'bicycle_rental'}],
                icon: 'carto:amenity/rental_bicycle.svg',
            },
            {
                id: 'bicycle_repair_station',
                titleRu: 'Ремонтная станция для велосипедов',
                titleEn: 'Bicycle repair station',
                filters: [{amenity: 'bicycle_repair_station'}],
                icon: 'carto:amenity/bicycle_repair_station.svg',
                minZoom: 12,
            },
            {
                id: 'bus_stop',
                titleRu: 'Автобусная остановка, автостанция',
                titleEn: 'Bus stop, bus station',
                filters: [{highway: 'bus_stop'}, {amenity: 'bus_station'}],
                icon: 'carto:highway/bus_stop.svg',
            },
            {
                id: 'railway_station',
                titleRu: 'Ж/д станция, платформа, остановка',
                titleEn: 'Railway station, halt, platform',
                filters: [{railway: ['station', 'halt', 'platform']}, {public_transport: 'platform'}],
                icon: 'maki:rail',
                minZoom: 12,
            },
            {
                id: 'tram_stop',
                titleRu: 'Трамвайная остановка',
                titleEn: 'Tram stop',
                filters: [{railway: 'tram_stop'}],
                icon: 'maki:rail-light',
            },
            {
                id: 'ferry_terminal',
                titleRu: 'Паромный терминал',
                titleEn: 'Ferry terminal',
                filters: [{amenity: 'ferry_terminal'}],
                icon: 'carto:amenity/ferry.svg',
                minZoom: 12,
            },
            {
                id: 'aerialway_station',
                titleRu: 'Канатная дорога, подъёмник',
                titleEn: 'Aerialway station',
                filters: [{aerialway: 'station'}],
                minZoom: 12,
            },
            {
                id: 'trailhead',
                titleRu: 'Начало тропы',
                titleEn: 'Trailhead',
                filters: [{highway: 'trailhead'}],
                icon: 'carto:tourism/guidepost.svg',
                minZoom: 12,
            },
            {id: 'pier', titleRu: 'Причал, пирс', titleEn: 'Pier', filters: [{man_made: 'pier'}], minZoom: 12},
            {
                id: 'marina',
                titleRu: 'Марина, слип',
                titleEn: 'Marina, slipway',
                filters: [{leisure: 'marina'}, {leisure: 'slipway'}],
                icon: 'carto:leisure/slipway.svg',
                minZoom: 12,
            },
            {id: 'taxi', titleRu: 'Такси', titleEn: 'Taxi', filters: [{amenity: 'taxi'}]},
        ],
    },
    {
        id: 'health',
        titleRu: 'Здоровье и безопасность',
        titleEn: 'Health and safety',
        minZoom: 13,
        categories: [
            {
                id: 'pharmacy',
                titleRu: 'Аптека',
                titleEn: 'Pharmacy',
                filters: [{amenity: 'pharmacy'}, {healthcare: 'pharmacy'}],
                icon: 'carto:amenity/pharmacy.svg',
            },
            {
                id: 'hospital',
                titleRu: 'Больница',
                titleEn: 'Hospital',
                filters: [{amenity: 'hospital'}, {healthcare: 'hospital'}],
                icon: 'carto:amenity/hospital.svg',
                minZoom: 12,
            },
            {
                id: 'clinic',
                titleRu: 'Поликлиника, врач',
                titleEn: 'Clinic, doctor',
                filters: [{amenity: ['clinic', 'doctors']}, {healthcare: ['clinic', 'doctor']}],
                icon: 'maki:doctor',
            },
            {
                id: 'dentist',
                titleRu: 'Стоматология',
                titleEn: 'Dentist',
                filters: [{amenity: 'dentist'}, {healthcare: 'dentist'}],
                icon: 'maki:dentist',
            },
            {
                id: 'veterinary',
                titleRu: 'Ветеринарная клиника',
                titleEn: 'Veterinary',
                filters: [{amenity: 'veterinary'}, {healthcare: 'veterinary'}],
            },
            {
                id: 'police',
                titleRu: 'Полиция',
                titleEn: 'Police',
                filters: [{amenity: 'police'}],
                icon: 'carto:amenity/police.svg',
                minZoom: 12,
            },
            {
                id: 'fire_station',
                titleRu: 'Пожарная часть',
                titleEn: 'Fire station',
                filters: [{amenity: 'fire_station'}],
                icon: 'carto:amenity/firestation.svg',
                minZoom: 12,
            },
            {
                id: 'rescue',
                titleRu: 'Горноспасатели, спасатели',
                titleEn: 'Rescue',
                filters: [{emergency: ['mountain_rescue', 'water_rescue', 'lifeguard']}],
                minZoom: 11,
            },
            {
                id: 'emergency_phone',
                titleRu: 'Экстренный телефон',
                titleEn: 'Emergency phone',
                filters: [{emergency: 'phone'}],
                icon: 'carto:amenity/emergency_phone.svg',
            },
            {
                id: 'defibrillator',
                titleRu: 'Дефибриллятор',
                titleEn: 'Defibrillator',
                filters: [{emergency: 'defibrillator'}],
            },
            {
                id: 'toilets',
                titleRu: 'Туалет',
                titleEn: 'Toilets',
                filters: [{amenity: 'toilets'}],
                icon: 'carto:amenity/toilets.svg',
            },
        ],
    },
    {
        id: 'attractions',
        titleRu: 'Достопримечательности',
        titleEn: 'Attractions',
        minZoom: 12,
        categories: [
            {
                id: 'viewpoint',
                titleRu: 'Смотровая площадка',
                titleEn: 'Viewpoint',
                filters: [{tourism: 'viewpoint'}],
                icon: 'carto:tourism/viewpoint.svg',
                minZoom: 11,
            },
            {
                id: 'attraction',
                titleRu: 'Достопримечательность',
                titleEn: 'Attraction',
                filters: [{tourism: 'attraction'}],
            },
            {id: 'museum', titleRu: 'Музей', titleEn: 'Museum', filters: [{tourism: 'museum'}], icon: 'maki:museum'},
            {id: 'gallery', titleRu: 'Галерея', titleEn: 'Gallery', filters: [{tourism: 'gallery'}]},
            {id: 'artwork', titleRu: 'Арт-объект', titleEn: 'Artwork', filters: [{tourism: 'artwork'}]},
            {
                id: 'zoo',
                titleRu: 'Зоопарк, аквариум',
                titleEn: 'Zoo, aquarium',
                filters: [{tourism: 'zoo'}, {tourism: 'aquarium'}],
            },
            {
                id: 'theme_park',
                titleRu: 'Парк развлечений',
                titleEn: 'Theme park',
                filters: [{tourism: 'theme_park'}],
                icon: 'maki:amusement-park',
            },
            {
                id: 'information',
                titleRu: 'Информационный щит, указатель',
                titleEn: 'Information board',
                filters: [{tourism: 'information'}],
                icon: 'carto:tourism/guidepost.svg',
            },
            {
                id: 'castle',
                titleRu: 'Замок',
                titleEn: 'Castle',
                filters: [{historic: 'castle'}],
                icon: 'carto:historic/castle.svg',
                minZoom: 11,
            },
            {id: 'ruins', titleRu: 'Руины', titleEn: 'Ruins', filters: [{historic: 'ruins'}]},
            {
                id: 'monument',
                titleRu: 'Памятник, монумент, мемориал',
                titleEn: 'Monument, memorial',
                filters: [{historic: 'monument'}, {historic: 'memorial'}],
                icon: 'maki:monument',
            },
            {
                id: 'archaeological_site',
                titleRu: 'Археологический объект',
                titleEn: 'Archaeological site',
                filters: [{historic: 'archaeological_site'}],
            },
            {
                id: 'wayside_cross',
                titleRu: 'Крест, часовня, обо',
                titleEn: 'Wayside cross, shrine',
                filters: [{historic: 'wayside_cross'}, {historic: 'wayside_shrine'}],
            },
            {
                id: 'fort',
                titleRu: 'Крепость, ворота, вал',
                titleEn: 'Fort, city gate, city walls',
                filters: [{historic: 'fort'}, {historic: 'city_gate'}, {historic: 'citywalls'}],
            },
            {id: 'battlefield', titleRu: 'Поле боя', titleEn: 'Battlefield', filters: [{historic: 'battlefield'}]},
            {id: 'wreck', titleRu: 'Затонувшее судно', titleEn: 'Wreck', filters: [{historic: 'wreck'}]},
            {
                id: 'place_of_worship',
                titleRu: 'Место поклонения',
                titleEn: 'Place of worship',
                filters: [{amenity: 'place_of_worship'}],
                icon: 'carto:amenity/place_of_worship.svg',
            },
            {
                id: 'tower',
                titleRu: 'Башня',
                titleEn: 'Tower',
                filters: [{man_made: 'tower'}],
                icon: 'carto:man_made/tower_generic.svg',
            },
            {
                id: 'lighthouse',
                titleRu: 'Маяк',
                titleEn: 'Lighthouse',
                filters: [{man_made: 'lighthouse'}],
                icon: 'carto:man_made/lighthouse.svg',
                minZoom: 11,
            },
            {
                id: 'water_tower',
                titleRu: 'Водонапорная башня',
                titleEn: 'Water tower',
                filters: [{man_made: 'water_tower'}],
                icon: 'carto:man_made/water_tower.svg',
            },
            {
                id: 'mill',
                titleRu: 'Мельница',
                titleEn: 'Mill',
                filters: [{man_made: 'windmill'}, {man_made: 'watermill'}],
                icon: 'carto:man_made/windmill.svg',
            },
            {id: 'observatory', titleRu: 'Обсерватория', titleEn: 'Observatory', filters: [{man_made: 'observatory'}]},
            {
                id: 'survey_point',
                titleRu: 'Геодезический пункт',
                titleEn: 'Survey point',
                filters: [{man_made: 'survey_point'}],
            },
            {id: 'cairn', titleRu: 'Каирн, тур', titleEn: 'Cairn', filters: [{man_made: 'cairn'}]},
            {
                id: 'mineshaft',
                titleRu: 'Шахта, штольня',
                titleEn: 'Mineshaft, adit',
                filters: [{man_made: 'mineshaft'}, {man_made: 'adit'}],
            },
        ],
    },
    {
        id: 'nature',
        titleRu: 'Природа',
        titleEn: 'Nature',
        minZoom: 11,
        categories: [
            {
                id: 'peak',
                titleRu: 'Вершина',
                titleEn: 'Peak',
                filters: [{natural: 'peak'}],
                icon: 'carto:natural/peak.svg',
                minZoom: 11,
            },
            {id: 'saddle', titleRu: 'Перевал', titleEn: 'Saddle', filters: [{natural: 'saddle'}]},
            {
                id: 'cave_entrance',
                titleRu: 'Пещера, вход',
                titleEn: 'Cave entrance',
                filters: [{natural: 'cave_entrance'}],
            },
            {
                id: 'volcano',
                titleRu: 'Вулкан',
                titleEn: 'Volcano',
                filters: [{natural: 'volcano'}],
                icon: 'maki:volcano',
                minZoom: 11,
            },
            {id: 'glacier', titleRu: 'Ледник', titleEn: 'Glacier', filters: [{natural: 'glacier'}], minZoom: 11},
            {
                id: 'rock',
                titleRu: 'Скала, валун',
                titleEn: 'Rock, stone',
                filters: [{natural: 'rock'}, {natural: 'stone'}],
            },
            {id: 'cliff', titleRu: 'Обрыв', titleEn: 'Cliff', filters: [{natural: 'cliff'}], icon: 'carto:cliff.svg'},
            {
                id: 'bay',
                titleRu: 'Залив, мыс, остров',
                titleEn: 'Bay, cape, island',
                filters: [{natural: 'bay'}, {natural: 'cape'}, {natural: 'island'}, {natural: 'islet'}],
                minZoom: 11,
            },
            {
                id: 'nature_reserve',
                titleRu: 'Заповедник',
                titleEn: 'Nature reserve',
                filters: [{leisure: 'nature_reserve'}],
                minZoom: 11,
            },
            {
                id: 'park',
                titleRu: 'Парк, сад',
                titleEn: 'Park, garden',
                filters: [{leisure: 'park'}, {leisure: 'garden'}],
                icon: 'maki:park',
            },
            {
                id: 'bird_hide',
                titleRu: 'Вышка для наблюдения за птицами',
                titleEn: 'Bird hide',
                filters: [{leisure: 'bird_hide'}],
                icon: 'carto:leisure/bird_hide.svg',
            },
            {
                id: 'fishing',
                titleRu: 'Рыбалка',
                titleEn: 'Fishing',
                filters: [{leisure: 'fishing'}],
                icon: 'carto:leisure/fishing.svg',
            },
            {
                id: 'swimming_pool',
                titleRu: 'Бассейн, аквапарк',
                titleEn: 'Swimming pool, water park',
                filters: [{leisure: 'swimming_pool'}, {leisure: 'water_park'}],
                icon: 'carto:leisure/water_park.svg',
            },
            {
                id: 'sauna',
                titleRu: 'Сауна, баня',
                titleEn: 'Sauna',
                filters: [{leisure: 'sauna'}],
                icon: 'carto:leisure/sauna.svg',
            },
            {
                id: 'playground',
                titleRu: 'Детская площадка',
                titleEn: 'Playground',
                filters: [{leisure: 'playground'}],
                icon: 'carto:leisure/playground.svg',
            },
            {
                id: 'sport',
                titleRu: 'Спортплощадка, стадион',
                titleEn: 'Pitch, sports centre, stadium',
                filters: [{leisure: 'pitch'}, {leisure: 'sports_centre'}, {leisure: 'stadium'}],
            },
            {
                id: 'dog_park',
                titleRu: 'Площадка для собак',
                titleEn: 'Dog park',
                filters: [{leisure: 'dog_park'}],
                icon: 'maki:dog-park',
            },
        ],
    },
    {
        id: 'service',
        titleRu: 'Сервис и связь',
        titleEn: 'Services and communication',
        minZoom: 14,
        categories: [
            {
                id: 'bank',
                titleRu: 'Банк',
                titleEn: 'Bank',
                filters: [{amenity: 'bank'}],
                icon: 'carto:amenity/bank.svg',
            },
            {
                id: 'atm',
                titleRu: 'Банкомат',
                titleEn: 'ATM',
                filters: [{amenity: 'atm'}],
                icon: 'carto:amenity/atm.svg',
            },
            {
                id: 'post_office',
                titleRu: 'Почта',
                titleEn: 'Post office',
                filters: [{amenity: 'post_office'}],
                icon: 'carto:amenity/post_office.svg',
            },
            {id: 'parcel_locker', titleRu: 'Постамат', titleEn: 'Parcel locker', filters: [{amenity: 'parcel_locker'}]},
            {
                id: 'post_box',
                titleRu: 'Почтовый ящик',
                titleEn: 'Post box',
                filters: [{amenity: 'post_box'}],
                icon: 'carto:amenity/post_box.svg',
            },
            {
                id: 'library',
                titleRu: 'Библиотека',
                titleEn: 'Library',
                filters: [{amenity: 'library'}],
                icon: 'carto:amenity/library.svg',
                minZoom: 13,
            },
            {
                id: 'townhall',
                titleRu: 'Администрация',
                titleEn: 'Town hall',
                filters: [{amenity: 'townhall'}],
                minZoom: 13,
            },
            {
                id: 'community_centre',
                titleRu: 'Общественный центр',
                titleEn: 'Community centre',
                filters: [{amenity: 'community_centre'}],
                minZoom: 13,
            },
            {
                id: 'waste',
                titleRu: 'Мусорные баки, утилизация',
                titleEn: 'Waste basket, recycling',
                filters: [{amenity: 'waste_basket'}, {amenity: 'waste_disposal'}, {amenity: 'recycling'}],
            },
            {
                id: 'bench',
                titleRu: 'Скамейка',
                titleEn: 'Bench',
                filters: [{amenity: 'bench'}],
                icon: 'carto:amenity/bench.svg',
            },
            {id: 'clock', titleRu: 'Часы', titleEn: 'Clock', filters: [{amenity: 'clock'}]},
            {
                id: 'public_bookcase',
                titleRu: 'Общественный книжный шкаф',
                titleEn: 'Public bookcase',
                filters: [{amenity: 'public_bookcase'}],
            },
            {
                id: 'communications_tower',
                titleRu: 'Вышка связи',
                titleEn: 'Communications tower',
                filters: [
                    {man_made: ['communications_tower', 'mast']},
                    {'man_made': 'tower', 'tower:type': 'communication'},
                ],
                icon: 'carto:man_made/communications_tower.svg',
                minZoom: 12,
            },
        ],
    },
];

const poiCategories = [];
const poiCategoriesById = new Map();
for (const group of poiGroups) {
    for (const category of group.categories) {
        category.groupId = group.id;
        if (category.minZoom === undefined) {
            category.minZoom = group.minZoom;
        }
        poiCategories.push(category);
        poiCategoriesById.set(category.id, category);
    }
}

function getCategory(id) {
    return poiCategoriesById.get(id);
}

/*
 Returns the matching category with the most specific filter (the filter with the biggest number of
 tag conditions), or null when no category matches the tags.
 */
function matchCategory(tags, categories) {
    let bestCategory = null;
    let bestScore = 0;
    for (const category of categories) {
        for (const filter of category.filters) {
            const keys = Object.keys(filter);
            let matches = true;
            for (const key of keys) {
                const expected = filter[key];
                const values = Array.isArray(expected) ? expected : [expected];
                if (!values.includes(tags[key])) {
                    matches = false;
                    break;
                }
            }
            if (matches && keys.length > bestScore) {
                bestScore = keys.length;
                bestCategory = category;
            }
        }
    }
    return bestCategory;
}

export {poiGroups, poiCategories, getCategory, matchCategory};
