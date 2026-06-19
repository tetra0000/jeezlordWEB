// Random place names for newly founded Town Centers (so every TC starts named).
// A spread of real UK town/city names — purely cosmetic flavour; the player can
// always rename a TC (the `rename` intent). Server-only data.
const UK_TOWN_NAMES: readonly string[] = [
  'Ashford', 'Bakewell', 'Banbury', 'Barnsley', 'Bedford', 'Beverley', 'Bideford',
  'Blackburn', 'Bolton', 'Bourne', 'Bradford', 'Bridgwater', 'Brighton', 'Bristol',
  'Bromley', 'Buxton', 'Cambridge', 'Canterbury', 'Carlisle', 'Chelmsford', 'Chepstow',
  'Chester', 'Chichester', 'Clitheroe', 'Colchester', 'Corby', 'Coventry', 'Crewe',
  'Darlington', 'Dartmouth', 'Derby', 'Devizes', 'Doncaster', 'Dorchester', 'Dover',
  'Dudley', 'Dunstable', 'Durham', 'Ely', 'Epsom', 'Exeter', 'Falmouth', 'Fareham',
  'Faversham', 'Gillingham', 'Glossop', 'Gloucester', 'Grantham', 'Grimsby', 'Guildford',
  'Halifax', 'Harrogate', 'Hartlepool', 'Hastings', 'Hereford', 'Hexham', 'Honiton',
  'Ipswich', 'Kendal', 'Keswick', 'Kettering', 'Lancaster', 'Launceston', 'Leeds',
  'Leominster', 'Lewes', 'Lichfield', 'Lincoln', 'Ludlow', 'Luton', 'Macclesfield',
  'Maidstone', 'Malton', 'Margate', 'Marlow', 'Melksham', 'Morpeth', 'Nantwich',
  'Newark', 'Newbury', 'Northampton', 'Norwich', 'Nottingham', 'Oakham', 'Oldham',
  'Ormskirk', 'Oswestry', 'Oxford', 'Penrith', 'Penzance', 'Peterborough', 'Pickering',
  'Plymouth', 'Pontefract', 'Poole', 'Preston', 'Ramsgate', 'Reading', 'Redditch',
  'Reigate', 'Richmond', 'Rochdale', 'Romsey', 'Rothbury', 'Rugby', 'Rugeley',
  'Salisbury', 'Sandwich', 'Scarborough', 'Sevenoaks', 'Shaftesbury', 'Sheffield',
  'Shrewsbury', 'Skipton', 'Sleaford', 'Stafford', 'Stamford', 'Stockport', 'Stroud',
  'Sudbury', 'Sunderland', 'Swindon', 'Tamworth', 'Taunton', 'Tavistock', 'Tewkesbury',
  'Thirsk', 'Tiverton', 'Torquay', 'Totnes', 'Truro', 'Uttoxeter', 'Wakefield',
  'Wallingford', 'Wantage', 'Wareham', 'Warwick', 'Wells', 'Whitby', 'Wigan',
  'Winchester', 'Windsor', 'Wisbech', 'Woking', 'Worcester', 'Workington', 'Yeovil', 'York',
];

// A random town name. `avoid` (a set of names already in use) is best-effort —
// skipped if every name is taken.
export function randomTownName(avoid?: ReadonlySet<string>): string {
  if (avoid && avoid.size < UK_TOWN_NAMES.length) {
    for (let i = 0; i < 12; i++) {
      const n = UK_TOWN_NAMES[Math.floor(Math.random() * UK_TOWN_NAMES.length)];
      if (!avoid.has(n)) return n;
    }
  }
  return UK_TOWN_NAMES[Math.floor(Math.random() * UK_TOWN_NAMES.length)];
}
