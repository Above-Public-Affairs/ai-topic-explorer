/**
 * Each watch item's theme vocabulary (task 4.8): the ideas its answers are
 * expected to discuss, one entry per idea. Every theme label an answer gives
 * is linked to one of these, or to a "new" theme when none fits (lib/themes
 * link.ts). Entries are read by the label mapper, so the description says
 * what belongs and, where two entries sit close, what doesn't.
 *
 * Rules for editing:
 * - One idea per entry. Sub-topics stay apart: a water cost is not a power
 *   cost. Don't add a catch-all ("impacts", "concerns").
 * - Never rename a slug: snapshots compare by it. Change name or description
 *   freely; add entries any time (`npm run themes -- --seed`).
 * - `aliases` are labels that mean exactly this entry, matched by themeKey()
 *   with no AI call. Only add ones that can't mean anything else. A sub-topic
 *   entry's aliases match labels tagged with that sub-topic or none; an
 *   overall entry's match only labels with no sub-topic. Everything else
 *   goes to the mapper, which sees the sub-topic.
 * - Keyed by WatchItem.name. `subTopic` is a SubTopic name of that item, or null.
 * - Industries and topics only: no client, ally or opponent framing.
 */

export interface VocabTheme {
  slug: string;
  name: string;
  subTopic: string | null;
  description: string;
  aliases?: string[];
}

const DATA_CENTERS_TX: VocabTheme[] = [
  // power generation
  {
    slug: "electricity-demand",
    name: "Electricity demand growth",
    subTopic: "power generation",
    description:
      "How much more power data centers need: load growth, AI-driven demand, forecasts and speculative or duplicate load requests. Not prices (electricity-bills) or grid strain (grid-reliability).",
    aliases: ["electricity demand", "power demand", "demand growth", "rising electricity demand", "energy demand", "load growth", "ai driven demand", "demand forecasts", "speculative demand"],
  },
  {
    slug: "grid-reliability",
    name: "Grid strain and reliability",
    subTopic: "power generation",
    description: "Whether ERCOT's grid can keep up: strain, reserve margins, blackout and outage risk, reliability during peaks and storms.",
    aliases: ["grid reliability", "grid strain", "power grid strain", "reliability risks", "blackout risk", "grid stability"],
  },
  {
    slug: "electricity-bills",
    name: "Electricity prices and bills",
    subTopic: "power generation",
    description:
      "Effect on what people pay for power: household bills, retail rates, wholesale prices, other drivers of bills. Not who pays for grid upgrades (grid-cost-allocation).",
    aliases: ["electricity costs", "electricity bills", "electricity prices", "household bills", "wholesale prices", "power bills", "electric bills", "consumer electricity costs", "utility bills"],
  },
  {
    slug: "grid-cost-allocation",
    name: "Who pays for grid upgrades",
    subTopic: "power generation",
    description:
      "How the cost of new lines, substations and generation for data centers is split between them and other ratepayers: cost allocation, large-load tariffs, ratepayer protections.",
    aliases: ["cost allocation", "ratepayer protections", "grid infrastructure costs", "grid costs", "grid upgrade costs"],
  },
  {
    slug: "transmission-interconnection",
    name: "Transmission and interconnection",
    subTopic: "power generation",
    description: "Connecting data centers to the grid: interconnection queues and rules, transmission build-out, bottlenecks.",
    aliases: ["transmission bottlenecks", "interconnection queue", "interconnection policy", "transmission", "transmission constraints"],
  },
  {
    slug: "onsite-generation",
    name: "On-site and dedicated generation",
    subTopic: "power generation",
    description: "Data centers bringing their own power: behind-the-meter or co-located plants, backup generators, dedicated gas or nuclear units.",
    aliases: ["on site generation", "dedicated generation", "backup generation", "behind the meter generation", "backup generators"],
  },
  {
    slug: "demand-flexibility",
    name: "Demand flexibility and curtailment",
    subTopic: "power generation",
    description: "Data centers cutting or shifting their use when the grid is tight: curtailment, demand response, emergency disconnection rules.",
    aliases: ["demand flexibility", "demand response", "curtailment", "load flexibility"],
  },
  {
    slug: "power-sources",
    name: "Power sources and emissions",
    subTopic: "power generation",
    description: "What fuels supply data centers (gas, wind, solar, nuclear), clean-energy pledges and purchases, and the resulting emissions.",
    aliases: ["power sources", "energy sources", "clean energy", "renewable energy", "carbon emissions", "energy mix"],
  },
  // water use
  {
    slug: "water-consumption",
    name: "How much water data centers use",
    subTopic: "water use",
    description:
      "Volumes of water used or withdrawn, per facility or nationally, and how it varies by design, climate and size. Not the effect on local supplies (local-water-supply) or power plants' water (indirect-water).",
    aliases: ["water use", "water consumption", "water demand", "direct water use", "on site water use", "facility level variation", "national water use", "national water consumption", "evaporative consumption", "withdrawal versus consumption", "cooling water demand", "usage variability"],
  },
  {
    slug: "cooling-technology",
    name: "Cooling technology",
    subTopic: "water use",
    description: "How data centers are cooled and how that changes water use: evaporative, air, closed-loop or liquid cooling, efficiency, alternative designs.",
    aliases: ["cooling technology", "cooling methods", "alternative cooling", "alternative cooling methods", "cooling alternatives", "cooling efficiency", "cooling design", "closed loop cooling"],
  },
  {
    slug: "reclaimed-water",
    name: "Recycled and reclaimed water",
    subTopic: "water use",
    description: "Using treated wastewater or other non-drinking water instead of potable water: adoption by operators, treatment and reuse, drinking-water savings.",
    aliases: ["recycled water adoption", "reclaimed water use", "reclaimed water cooling", "reclaimed water adoption", "potable water conservation", "drinking water conservation", "potable water savings", "recycled water", "reclaimed water", "treatment and reuse", "alternative water sources"],
  },
  {
    slug: "local-water-supply",
    name: "Strain on local water supplies",
    subTopic: "water use",
    description: "Effect on the water available to towns, farms and others: drought, aquifers, scarcity, local water infrastructure and pressure.",
    aliases: ["local water stress", "local water strain", "local supply strain", "water scarcity", "local water impacts", "water infrastructure", "water pressure", "drought"],
  },
  {
    slug: "indirect-water",
    name: "Water used to make their power",
    subTopic: "water use",
    description: "Water consumed by the power plants that supply data centers, as opposed to water used on site.",
    aliases: ["indirect water footprint", "indirect water use", "indirect power water", "power generation water"],
  },
  {
    slug: "water-reporting",
    name: "Water use reporting and transparency",
    subTopic: "water use",
    description: "Whether and how operators disclose water use: reporting rules and compliance, missing data, uncertainty in the figures.",
    aliases: ["water reporting", "water reporting compliance", "reporting compliance", "reporting noncompliance", "measurement uncertainty", "water transparency"],
  },
  // noise
  {
    slug: "noise-sources",
    name: "Noise sources and levels",
    subTopic: "noise",
    description: "What makes the noise and how loud it is: cooling fans, chillers, generators, constant or low-frequency hum, decibel levels and how they vary.",
    aliases: ["noise sources", "cooling noise", "low frequency hum", "generator noise", "noise sources and levels", "continuous equipment noise", "noise levels", "noise variability"],
  },
  {
    slug: "noise-health",
    name: "Sleep and health effects of noise",
    subTopic: "noise",
    description: "What the noise does to neighbors: sleep disruption, stress, health effects, nuisance and disruption, quality of life at home.",
    aliases: ["sleep disruption", "noise and sleep", "sleep and health effects", "noise and quality of life", "health effects of noise"],
  },
  {
    slug: "noise-mitigation",
    name: "Noise mitigation",
    subTopic: "noise",
    description: "Ways to make data centers quieter and how well they work: acoustic design, quieter equipment, walls, berms and barriers.",
    aliases: ["noise mitigation", "acoustic mitigation", "acoustic design", "noise reduction", "sound barriers"],
  },
  {
    slug: "noise-rules",
    name: "Noise rules and enforcement",
    subTopic: "noise",
    description: "Limits on noise and who enforces them: ordinances, county authority, monitoring, acoustic studies, complaints and enforcement gaps.",
    aliases: ["noise limits", "noise regulation", "noise rules", "noise ordinances", "monitoring and enforcement", "noise guidelines", "noise assessment", "acoustic studies"],
  },
  {
    slug: "siting-setbacks",
    name: "Siting and distance from homes",
    subTopic: "noise",
    description: "Where data centers are built relative to neighborhoods: setbacks, buffers, distance from homes.",
    aliases: ["siting and setbacks", "siting and distance", "distance and setbacks", "distance and siting", "setbacks and siting", "setbacks", "distance and barriers"],
  },
  // overall
  {
    slug: "tax-incentives",
    name: "Tax breaks and incentives",
    subTopic: null,
    description: "State and local tax breaks for data centers (sales-tax exemptions, abatements) and whether they pay off. Not the tax revenue they bring (local-tax-revenue).",
    aliases: ["tax incentives", "tax exemptions", "tax breaks", "state tax exemptions", "economic incentives", "tax abatements", "tax incentives and returns"],
  },
  {
    slug: "local-tax-revenue",
    name: "Local tax revenue",
    subTopic: null,
    description: "Property and other taxes data centers pay to counties, cities and school districts.",
    aliases: ["tax revenue", "local tax revenue", "property tax revenue", "local property taxes"],
  },
  {
    slug: "jobs",
    name: "Jobs",
    subTopic: null,
    description: "Construction and permanent jobs, how many there are, and the wages they pay.",
    aliases: ["jobs", "construction jobs", "permanent jobs", "permanent employment", "jobs and wages", "construction employment", "job creation", "employment"],
  },
  {
    slug: "economic-development",
    name: "Investment and economic growth",
    subTopic: null,
    description: "Broader economic effects beyond jobs and taxes: investment, local business activity, regional growth.",
    aliases: ["economic benefits", "economic activity", "economic development", "economic opportunity", "regional growth", "investment"],
  },
  {
    slug: "local-control",
    name: "Local control and zoning",
    subTopic: null,
    description: "What cities and counties can do about data centers: zoning, annexation, permitting, limits on local authority in Texas.",
    aliases: ["local control", "zoning", "zoning gaps", "local restrictions", "annexation authority", "zoning timeline"],
  },
  {
    slug: "state-oversight",
    name: "State and federal policy",
    subTopic: null,
    description: "Rules and oversight from the state or federal government (legislature, PUC, TCEQ, Congress), gaps in oversight, policy responses and pauses.",
    aliases: ["regulatory oversight", "regulatory response", "policy response", "oversight gaps", "state regulation", "legislative uncertainty", "approval pause"],
  },
  {
    slug: "community-impacts",
    name: "Effects on nearby communities",
    subTopic: null,
    description:
      "Day-to-day effects on neighbors and towns other than power, water or noise: land use, traffic, light, housing, character, who bears costs vs benefits. Not noise effects on neighbors (noise-health).",
    aliases: ["community impacts", "neighborhood impacts", "neighbor impacts", "uneven costs and benefits"],
  },
  {
    slug: "community-benefits",
    name: "Community benefits and protections",
    subTopic: null,
    description: "What communities get or can demand in return: community benefit agreements, funds, protections for residents.",
    aliases: ["community benefits", "community protections", "resident protections", "community benefit agreements"],
  },
  {
    slug: "public-opinion",
    name: "Public opinion and opposition",
    subTopic: null,
    description: "How residents feel and act: support, concern, opposition, complaints, organizing and public participation.",
    aliases: ["public opinion", "public concern", "public opposition", "community opinion", "community opposition", "resident complaints", "community complaints", "public participation"],
  },
  {
    slug: "project-transparency",
    name: "Project secrecy and uncertainty",
    subTopic: null,
    description: "How little is known about specific projects: secrecy, NDAs and code names, uncertain plans and timelines, accountability.",
    aliases: ["project uncertainty", "secrecy", "transparency", "local accountability", "nondisclosure agreements"],
  },
];

const OIL_GAS_NM: VocabTheme[] = [
  {
    slug: "energy-prices",
    name: "Energy bills and fuel prices",
    subTopic: null,
    description: "What New Mexicans pay for gas, electricity and gasoline, and why it doesn't track how much the state produces.",
    aliases: ["energy prices", "energy bills", "gas prices", "fuel prices", "utility bills", "gasoline prices", "electricity prices"],
  },
  {
    slug: "production-scale",
    name: "Production and industry size",
    subTopic: null,
    description: "How much oil and gas New Mexico produces, Permian growth, its rank among states, output trends.",
    aliases: ["production growth", "oil production", "production levels", "permian production", "production"],
  },
  {
    slug: "jobs",
    name: "Jobs and wages",
    subTopic: null,
    description: "Oil and gas jobs, their wages, who gets them and where; workforce.",
    aliases: ["jobs", "jobs and wages", "employment", "oil and gas jobs", "job creation", "workforce"],
  },
  {
    slug: "state-revenue",
    name: "State revenue and budget",
    subTopic: null,
    description: "Severance taxes, royalties and other oil and gas money in the state budget, permanent funds and how much the state depends on it. Not school funding specifically (school-funding).",
    aliases: ["state revenue", "state budget", "tax revenue", "severance taxes", "royalties", "budget surplus", "permanent funds", "public revenue"],
  },
  {
    slug: "school-funding",
    name: "School and education funding",
    subTopic: null,
    description: "Oil and gas money for schools and education: the Land Grant Permanent Fund, early childhood funding, school budgets.",
    aliases: ["school funding", "education funding", "land grant permanent fund", "early childhood funding"],
  },
  {
    slug: "revenue-volatility",
    name: "Boom, bust and dependence",
    subTopic: null,
    description: "Risk of relying on oil and gas: price swings, boom-and-bust cycles, revenue volatility, diversifying the economy.",
    aliases: ["revenue volatility", "boom and bust", "boom bust cycles", "economic dependence", "diversification", "economic diversification", "price volatility"],
  },
  {
    slug: "regional-economies",
    name: "Local and rural economies",
    subTopic: null,
    description: "What the industry means for the Permian, rural towns and regions of New Mexico, and how benefits spread (or don't) to places like Albuquerque.",
    aliases: ["rural economies", "rural livelihoods", "local economies", "regional economy", "regional disparities", "local economic benefits"],
  },
  {
    slug: "water-contamination",
    name: "Water contamination",
    subTopic: null,
    description: "Pollution of groundwater or surface water: spills, leaks, fracking fluids, well integrity. Not how much water the industry uses (water-use) or produced water handling (produced-water).",
    aliases: ["water contamination", "groundwater contamination", "groundwater pollution", "spills", "water pollution"],
  },
  {
    slug: "produced-water",
    name: "Produced water and wastewater",
    subTopic: null,
    description: "The salty wastewater that comes up with oil and gas: disposal, injection wells, reuse and treatment proposals.",
    aliases: ["produced water", "wastewater disposal", "produced water reuse", "wastewater injection"],
  },
  {
    slug: "water-use",
    name: "Water use and scarcity",
    subTopic: null,
    description: "Fresh water the industry consumes for drilling and fracking, and competition for scarce water.",
    aliases: ["water use", "water consumption", "water scarcity", "freshwater use"],
  },
  {
    slug: "air-pollution-health",
    name: "Air pollution and health",
    subTopic: null,
    description: "Air pollution from wells and facilities (ozone, VOCs, particulates) and health effects on people nearby.",
    aliases: ["air pollution", "air quality", "health impacts", "health risks", "ozone", "health and pollution", "public health"],
  },
  {
    slug: "methane-climate",
    name: "Methane, flaring and climate",
    subTopic: null,
    description: "Methane leaks, venting and flaring, and oil and gas's contribution to climate change.",
    aliases: ["methane emissions", "methane", "flaring", "venting and flaring", "climate change", "greenhouse gas emissions", "climate impacts"],
  },
  {
    slug: "noise-traffic",
    name: "Noise, traffic and trucks",
    subTopic: null,
    description: "Disruption near homes: drilling noise, lights, truck traffic, road damage and safety.",
    aliases: ["noise", "truck traffic", "traffic", "road damage", "drilling noise", "noise and traffic", "light pollution"],
  },
  {
    slug: "setbacks-siting",
    name: "Setbacks and distance from homes and schools",
    subTopic: null,
    description: "How close wells may be to homes, schools and water sources; setback rules and proposals.",
    aliases: ["setbacks", "setback rules", "school setbacks", "siting"],
  },
  {
    slug: "regulation-enforcement",
    name: "Regulation and enforcement",
    subTopic: null,
    description: "State and federal rules for the industry and how they're enforced: NMED, the Oil Conservation Division, EPA, penalties, inspections.",
    aliases: ["regulation", "enforcement", "regulatory oversight", "state regulation", "environmental regulation", "regulations"],
  },
  {
    slug: "federal-lands",
    name: "Federal lands and leasing",
    subTopic: null,
    description: "Drilling on federal and public lands: BLM leasing, federal policy changes, royalties from federal land.",
    aliases: ["federal lands", "federal leasing", "public lands", "blm leasing", "federal policy"],
  },
  {
    slug: "seismicity",
    name: "Induced earthquakes",
    subTopic: null,
    description: "Earthquakes linked to wastewater injection.",
    aliases: ["induced seismicity", "earthquakes", "seismic activity"],
  },
  {
    slug: "frontline-communities",
    name: "Tribal and frontline communities",
    subTopic: null,
    description: "Effects on tribal nations, Native and Hispanic communities and others living closest to production; environmental justice; sacred sites such as Chaco.",
    aliases: ["environmental justice", "tribal communities", "frontline communities", "indigenous communities"],
  },
  {
    slug: "energy-transition",
    name: "Energy transition",
    subTopic: null,
    description: "The industry's future as energy shifts: renewables, decline scenarios, planning for a post-oil economy.",
    aliases: ["energy transition", "renewable energy", "clean energy transition", "future of oil and gas"],
  },
  {
    slug: "public-opinion",
    name: "Public opinion and debate",
    subTopic: null,
    description: "How New Mexicans see the industry: support, opposition, divided views, political debate.",
    aliases: ["public opinion", "public debate", "community opposition", "political debate", "public concern"],
  },
];

const RENEWABLES_TX: VocabTheme[] = [
  // wind
  {
    slug: "wind-landscape",
    name: "Views and landscape (wind)",
    subTopic: "wind",
    description: "How wind farms look and change the land: views, blinking lights, rural character, scale of turbines.",
    aliases: ["visual impact", "visual impacts", "aesthetics", "scenic views", "landscape changes"],
  },
  {
    slug: "wind-wildlife",
    name: "Wildlife effects (wind)",
    subTopic: "wind",
    description: "Effects on birds, bats and habitat from turbines.",
    aliases: ["wildlife impacts", "bird deaths", "bird and bat deaths", "wildlife"],
  },
  // solar
  {
    slug: "solar-land-use",
    name: "Farmland and land use (solar)",
    subTopic: "solar",
    description: "Solar farms taking farmland or ranchland, land conversion, grazing and farming alongside panels.",
    aliases: ["land use", "farmland loss", "farmland", "agricultural land", "agrivoltaics"],
  },
  {
    slug: "panel-safety",
    name: "Panel materials, hail and runoff (solar)",
    subTopic: "solar",
    description: "Worries about what's in panels and what happens when they break: hail damage, toxic materials, runoff, glare.",
    aliases: ["hail damage", "toxic materials", "glare", "runoff"],
  },
  // BESS
  {
    slug: "battery-fire-safety",
    name: "Battery fire and safety risk",
    subTopic: "BESS",
    description: "Fire, explosion and toxic-smoke risk at battery storage sites, thermal runaway, emergency response and fire codes.",
    aliases: ["fire risk", "fire safety", "battery fires", "thermal runaway", "emergency response", "safety risks"],
  },
  {
    slug: "battery-grid-support",
    name: "Batteries supporting the grid",
    subTopic: "BESS",
    description: "Battery storage keeping the lights on: evening peaks, emergencies, storing solar, ERCOT's growing battery fleet.",
    aliases: ["grid support", "peak demand support", "energy storage", "storage capacity", "battery storage growth"],
  },
  // overall
  {
    slug: "property-values",
    name: "Property and land values",
    subTopic: null,
    description: "Effect of wind, solar or battery projects on nearby home and land values.",
    aliases: ["property values", "land values", "home values", "land and property values"],
  },
  {
    slug: "landowner-income",
    name: "Lease income for landowners",
    subTopic: null,
    description: "Lease and royalty payments to ranchers, farmers and landowners hosting projects; lease terms.",
    aliases: ["landowner income", "lease payments", "lease income", "landowner leases", "lease terms", "royalties"],
  },
  {
    slug: "jobs",
    name: "Jobs",
    subTopic: null,
    description: "Construction and operating jobs, how many and how long they last, wages.",
    aliases: ["jobs", "construction jobs", "permanent jobs", "employment", "job creation", "jobs and wages"],
  },
  {
    slug: "local-tax-revenue",
    name: "Local tax revenue",
    subTopic: null,
    description: "Property taxes and other payments to counties and school districts.",
    aliases: ["tax revenue", "local tax revenue", "property tax revenue", "school district revenue"],
  },
  {
    slug: "subsidies-incentives",
    name: "Subsidies and tax incentives",
    subTopic: null,
    description: "Federal tax credits, state and local abatements, and arguments about subsidizing renewables. Not the taxes projects pay (local-tax-revenue).",
    aliases: ["subsidies", "tax incentives", "tax credits", "federal tax credits", "tax abatements", "tax breaks"],
  },
  {
    slug: "grid-reliability",
    name: "Grid reliability and intermittency",
    subTopic: null,
    description: "Whether wind and solar make ERCOT more or less reliable: intermittency, the need for backup, performance in storms such as Winter Storm Uri.",
    aliases: ["grid reliability", "intermittency", "reliability", "winter storm uri", "blackout risk", "grid stability", "variability"],
  },
  {
    slug: "electricity-prices",
    name: "Electricity prices",
    subTopic: null,
    description: "Effect of renewables on wholesale prices and household bills.",
    aliases: ["electricity prices", "power prices", "electricity costs", "energy costs", "wholesale prices", "household bills"],
  },
  {
    slug: "transmission",
    name: "Transmission and curtailment",
    subTopic: null,
    description: "Lines to move power from West Texas to cities, CREZ, congestion and curtailed output.",
    aliases: ["transmission", "transmission lines", "curtailment", "congestion", "transmission constraints"],
  },
  {
    slug: "state-policy",
    name: "State policy and legislation",
    subTopic: null,
    description: "Texas laws and proposals aimed at renewables: permitting rules, fees, mandates for backup, legislative fights.",
    aliases: ["state policy", "legislation", "state legislation", "policy debate", "state regulation", "regulation"],
  },
  {
    slug: "local-siting",
    name: "Local siting rules and setbacks",
    subTopic: null,
    description: "Where projects may go: county rules, setbacks from homes, local permitting and limits on local authority.",
    aliases: ["setbacks", "siting", "local control", "local regulation", "zoning", "siting rules"],
  },
  {
    slug: "decommissioning",
    name: "Decommissioning and waste",
    subTopic: null,
    description: "What happens at end of life: removal, bonds, recycling or landfilling blades, panels and batteries.",
    aliases: ["decommissioning", "end of life", "recycling", "waste", "decommissioning bonds"],
  },
  {
    slug: "environmental-benefits",
    name: "Emissions and environmental benefits",
    subTopic: null,
    description: "Cleaner air, lower carbon emissions, water savings compared with fossil plants, climate benefits.",
    aliases: ["environmental benefits", "emissions reductions", "clean energy", "climate benefits", "carbon emissions"],
  },
  {
    slug: "growth-capacity",
    name: "Growth and Texas's lead",
    subTopic: null,
    description: "How much wind, solar and storage Texas has built, its national lead, growth trends and the project pipeline.",
    aliases: ["capacity growth", "growth", "market growth", "renewable growth", "installed capacity"],
  },
  {
    slug: "economic-development",
    name: "Rural economic development",
    subTopic: null,
    description: "Broader effects on rural economies and towns beyond jobs, leases and taxes: investment, local business.",
    aliases: ["economic benefits", "economic development", "rural economic development", "investment", "local economy"],
  },
  {
    slug: "public-opinion",
    name: "Public opinion and opposition",
    subTopic: null,
    description: "Local support and opposition, divided views, political framing of renewables.",
    aliases: ["public opinion", "local opposition", "community opposition", "public concern", "political debate"],
  },
];

export const THEME_VOCAB: Record<string, VocabTheme[]> = {
  "Data centers in Texas": DATA_CENTERS_TX,
  "Oil and gas in New Mexico": OIL_GAS_NM,
  "Renewables in Texas": RENEWABLES_TX,
};
