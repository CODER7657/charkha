# HackOut’26 – Problem Statements & Guidelines

Themes: Renewable Energy Intelligence & Circular Carbon Ecosystem


## 1. Only one problem statement must be chosen per team.

Each team is required to select a single problem statement from the provided list and work exclusively on it throughout the hackathon.

## 2. Technology suggestions are advisory, not mandatory.

The “Tech that can be used” section under each problem statement is provided for guidance only. Teams are free to use any other technologies, frameworks, or tools as long as they effectively address the problem statement.

## 3. Alignment with Impact and User Requirements.

Submissions will be evaluated on how well the solution meets the user needs and achieves the impact goals outlined in the problem statement.

## 4. One theme per team.

Teams must select their single chosen problem statement from either the Renewable Energy Intelligence or the Circular Carbon Ecosystem theme and are not required to address both themes.


## AI-Powered Renewable Generation Forecasting Platform

## Description:

Solar and wind power output fluctuates constantly with weather, time of day, and season, making it difficult for grid operators and utilities to plan capacity, schedule backup power, or avoid curtailment. This problem asks participants to build an intelligence platform that ingests weather data, historical generation records, and site-level parameters to forecast solar/wind output over the next 24–72 hours. The system should flag periods of expected over/under-generation and recommend grid actions (e.g., curtailment, storage dispatch, backup activation).

## User:

Grid operators, utility companies, renewable plant owners, energy traders.

## Impact:

- Reduces energy wastage and reliance on fossil-fuel backup plants.

- Improves grid stability by anticipating supply fluctuations in advance.

- Enables better financial planning for energy producers and traders.

## Tech that can be used:

- Time-series forecasting (Python: Prophet, LSTM, XGBoost)

- Weather/satellite data APIs

- Real-time dashboards (React, D3.js)

- Cloud data pipelines


## Predictive Maintenance for Solar & Wind Assets

## Description:

Unplanned downtime of solar panels or wind turbines causes significant energy and revenue loss, and manual inspection is slow and costly. This problem involves building a system that uses sensor data (vibration, temperature, current, panel soiling, etc.) to detect early signs of equipment degradation or failure. The platform should flag at-risk assets, prioritize maintenance visits, and estimate the energy/revenue loss of inaction.

## User:

Solar/wind farm operators, maintenance technicians, asset management companies.

## Impact:

- Minimizes downtime and maximizes energy yield.

- Lowers maintenance costs through predictive rather than reactive servicing.

- Extends the operational lifespan of renewable assets.

## Tech that can be used:

- IoT sensor simulation/integration

- AI/ML anomaly detection (Python: scikit-learn, TensorFlow)

- Mobile/web technician dashboards

- Cloud-based alerting systems


## Smart Demand-Response & Load-Shifting System

## Description:

Consumers and industries often draw power without regard to when renewable supply is at its peak, forcing grids to rely on non-renewable sources during shortfalls. This problem asks for a system that predicts renewable supply peaks and shifts flexible loads (EV charging, water heating, industrial processes) to align with them — either automatically or through user incentives.

## User:

Households, EV owners, industrial energy managers, utility demand-response programs.

## Impact:

- Increases effective utilization of renewable energy.

- Reduces peak-load strain on the grid.

- Lowers electricity costs for participating consumers.

## Tech that can be used:

- IoT device integration/simulation

- Optimization algorithms (Python, R)

- Mobile app with gamified incentives

- RESTful APIs for utility integration


## Microgrid Energy Mix Optimizer for Off-Grid Communities

## Description:

Rural and off-grid communities often rely on unreliable diesel generators alongside small-scale renewable installations. This problem requires an optimization engine that decides, in real time, the ideal mix of solar, wind, battery storage, and diesel backup to minimize cost and emissions while maintaining reliable uptime — accounting for weather forecasts and fuel costs.

## User:

Microgrid operators, rural electrification agencies, NGOs, off-grid communities.

## Impact:

- Reduces diesel dependency and associated emissions.

- Improves energy reliability in underserved areas.

- Lowers long-term energy costs for communities.

## Tech that can be used:

- Optimization/simulation models (Python, R)

- Weather/forecast API integration

- Web-based dashboards (React, D3.js)

- Battery/storage modeling libraries


## Renewable Energy P2P Trading Marketplace

## Description:

Households with rooftop solar often overproduce during peak sunlight hours and are forced to export surplus energy back to the grid at low feed-in tariffs, while nearby consumers may still be paying high retail rates. This problem asks participants to build a peer-to-peer energy trading platform where prosumers can sell surplus solar directly to nearby consumers, with dynamic pricing based on real-time supply, demand, and grid congestion.

## User:

Rooftop solar owners (prosumers), nearby consumers, utility companies, energy regulators.

## Impact:

- Gives prosumers fairer returns on surplus renewable generation.

- Reduces transmission losses through localized energy trading.

- Encourages wider adoption of rooftop solar installations.

## Tech that can be used:

- Blockchain/DLT for transaction transparency

- Smart contracts

- RESTful APIs

- Real-time pricing engines


## Renewable Energy Certificate (REC) Fraud Detection System

## Description:

Renewable Energy Certificates are used to prove that electricity was generated from renewable sources, but manual issuance and tracking processes are vulnerable to duplication and fraudulent claims. This problem requires building a system that uses anomaly detection and ledger-based tracking to flag suspicious REC issuance patterns, duplicate certificates, or mismatches between claimed and actual generation data.

## User:

Renewable energy regulators, certificate issuing bodies, corporate REC buyers, auditors.

## Impact:

- Strengthens integrity and trust in renewable energy markets.

- Reduces regulatory and reputational risk for genuine producers.

- Improves auditability of national/regional renewable energy claims.

## Tech that can be used:

- Blockchain/DLT

- AI/ML anomaly detection

- Data encryption

- Secure cloud storage


## EV Charging Network Renewable-Optimization Platform

## Description:

As EV adoption grows, charging stations often draw power regardless of whether it's coming from renewable or fossil sources at that moment. This problem asks for a platform that helps EV charging network operators schedule and price charging sessions to align with periods of high renewable grid supply, and gives EV drivers visibility into the “greenness” of their charging session in real time.

## User:

EV charging network operators, EV drivers, grid operators.

## Impact:

- Increases the share of EV charging powered by renewables.

- Helps operators reduce costs by avoiding peak/non-renewable pricing windows.

- Builds consumer awareness and demand for green charging options.

## Tech that can be used:

- Real-time grid data APIs

- Mobile app development

- Optimization/scheduling algorithms

- RESTful APIs


## Carbon Capture-to-Product Matchmaking Platform

## Description:

Industries that capture CO2 (cement, steel, power plants) often lack visibility into who can put that carbon to productive use (fuel synthesis, building materials, greenhouses, algae farming). This problem asks participants to build a marketplace where carbon emitters list available captured CO2 (volume, purity, location) and carbon-utilizing industries can discover, request, or bid on supply, with logistics and cost estimation built in.

## User:

Industrial carbon emitters, carbon-utilization startups, policy regulators, logistics providers.

## Impact:

- Converts captured carbon from a cost center into a tradeable resource.

- Reduces net emissions by closing the loop between capture and reuse.

- Accelerates adoption of carbon capture technology through clear economic incentive.

## Tech that can be used:

- RESTful APIs / marketplace backend

- Database integration (SQL/NoSQL)

- Logistics/route optimization

- Secure cloud storage


## Verifiable Carbon Credit & Offset Tracking System

## Description:

Carbon credit markets suffer from double-counting, lack of transparency, and weak verification. This problem requires building a blockchain- or ledger-based system that tracks carbon capture/reduction events end-to-end — from data capture (sensor/IoT or manual verification), through credit issuance, to final retirement — preventing double-selling and giving buyers a fully auditable trail.

## User:

Carbon credit issuers, corporate buyers, auditors, regulatory bodies.

## Impact:

- Increases trust and transparency in carbon markets.

- Prevents fraud and double-counting of credits.

- Encourages greater corporate participation in offset programs.

## Tech that can be used:

- Blockchain/DLT

- Smart contracts

- Digital identity solutions

- Data encryption


THEME: CIRCULAR CARBON ECOSYSTEM

## Industrial Emission Leak-Point Detector & Circular Alternative Recommender

## Description:

Small and medium industries often don't know exactly where their carbon footprint originates or what circular alternatives are available. This problem asks for a tool where a business inputs process data (energy source, materials, waste streams) and the system identifies top emission sources, then recommends specific circular interventions (e.g., alternative materials, recycling loops, process changes) along with estimated cost and CO2 savings.

## User:

SMEs, factory operators, sustainability consultants, industry regulators.

## Impact:

- Makes emission sources visible and actionable for smaller businesses.

- Drives adoption of circular practices through concrete, costed recommendations.

- Supports compliance with emerging carbon regulations.

## Tech that can be used:

- AI/ML recommendation models (Python)

- Data visualization dashboards (React, D3.js)

- RESTful APIs

- Cloud-based data storage


## Waste-to-Carbon-Value Chain Tracker

## Description:

Organic and industrial waste that could be converted into biochar, biogas, or carbon-negative materials frequently ends up in landfills instead. This problem involves building a platform that connects waste generators (farms, food industries, municipalities) with carbon-conversion facilities, optimizes collection logistics, and calculates the CO2 sequestered per ton of waste diverted from landfill.

## User:

Municipalities, farms, food/industrial waste generators, biochar/biogas facility operators.

## Impact:

- Diverts waste from landfills into productive, carbon-negative pathways.

- Provides measurable CO2 sequestration data for reporting and incentives.

- Creates new revenue streams for waste generators and conversion facilities.

## Tech that can be used:

- Route/logistics optimization

- Full-stack web GIS (Leaflet.js, Mapbox)

- Database integration

- Carbon calculation models


## Consumer Carbon Loop App

## Description:

Everyday consumers have little visibility into their personal carbon footprint and few easy ways to act on it. This problem asks participants to build an app that estimates a user's carbon footprint from purchases, transport, and energy use, then suggests concrete circular actions — repair vs. replace decisions, nearby recycling drop points, or verified offset options — and rewards users for taking action.

## User:

Individual consumers, eco-conscious brands, recycling facilities.

## Impact:

- Raises consumer awareness of everyday carbon impact.

- Drives behavior change toward circular consumption habits.

- Creates a channel for brands to reward sustainable customer behavior.

## Tech that can be used:

- Mobile app development

- Transaction categorization (NLP/ML)

- Location-based APIs (recycling points)

- Gamification engines


## Circular Packaging & Materials Exchange

## Description:

Manufacturing and retail industries generate large volumes of packaging waste, much of which could be reused or recycled if better matched between businesses. This problem involves building a B2B exchange platform where companies can list surplus or recyclable packaging materials (cardboard, plastics, pallets) for other businesses to claim or purchase, reducing landfill waste and virgin material use.

## User:

Manufacturers, retailers, packaging recyclers, logistics companies.

## Impact:

- Reduces packaging waste sent to landfill.

- Lowers material costs for businesses adopting recycled inputs.

- Cuts embodied carbon associated with virgin material production.

## Tech that can be used:

- Marketplace backend (Node.js/Python)

- Database integration (SQL/NoSQL)

- Logistics/route optimization

- RESTful APIs


## Carbon-Aware Supply Chain Dashboard

## Description:

Companies increasingly need to report and reduce Scope 3 (supply chain) emissions but lack tools to trace carbon impact across multi-tier suppliers. This problem asks for a dashboard that ingests supplier-level data (energy use, transport distances, materials) and calculates an aggregated, auditable carbon footprint across the supply chain, highlighting the highest-impact nodes and suggesting circular sourcing alternatives.

## User:

Corporate sustainability teams, supply chain managers, ESG auditors, suppliers.

## Impact:

- Improves accuracy and transparency of Scope 3 emissions reporting.

- Helps companies identify and prioritize the highest-impact reduction opportunities.

- Supports compliance with growing ESG disclosure requirements.

## Tech that can be used:

- Data visualization dashboards (React, D3.js)

- Data pipelines / ETL

- AI/ML for emissions estimation

- Secure cloud storage


## Algae-Based Carbon Sequestration Monitoring Platform

## Description:

Algae farms are emerging as a scalable way to capture CO2 and produce biofuel, food, or bioplastics, but tracking their actual sequestration performance is difficult. This problem requires a monitoring platform that combines sensor/IoT data (growth rate, CO2 uptake, water quality) with satellite or drone imagery to verify and report real-time carbon capture performance of algae cultivation sites.

## User:

Algae farm operators, carbon credit verifiers, environmental researchers, investors.

## Impact:

- Provides credible, data-backed verification of algae-based carbon capture.

- Attracts investment by making sequestration performance measurable.

- Supports the growth of algae-based circular carbon industries.

## Tech that can be used:

- IoT sensor integration/simulation

- Satellite/drone imagery APIs

- AI/ML for growth and uptake modeling

- Real-time dashboards


## AI-Powered Hyper-Personalized Banking for Bharat

## Background:

Indian banks have made massive strides in digital infrastructure — UPI, net banking, mobile apps, video KYC — yet a large section of customers (especially in Tier 2/3/4 towns and rural India) still find banking apps confusing, generic, and disconnected from their actual financial needs. At the same time, banks struggle with rising customer acquisition costs, high drop-offs in loan/product journeys, and difficulty cross-selling the right product to the right customer at the right time. Much of this stems from banks treating all customers with a one-size-fits-all digital experience, despite having rich transactional and behavioral data.

## Challenge:

Design an AI-powered solution that can:

- 1. Analyze a customer's transaction history, spending patterns, and life-stage signals (salary credits, EMI patterns, savings behavior, etc.) to proactively recommend the most relevant banking product (loan, insurance, investment, credit card) at the right moment — instead of generic pop-up offers.

- 2. Simplify and personalize the digital banking journey (onboarding, loan application, KYC) using conversational AI/chatbots in vernacular languages, reducing drop-offs for first-time digital users.

- 3. Detect early warning signals of financial stress or fraud (unusual transaction patterns, missed EMIs, sudden behavior change) and trigger proactive, empathetic interventions rather than purely punitive actions (like immediate loan default flags).

## Deliverables Expected from Participants:

- A conceptual architecture/flow diagram (data sources → AI engine → personalized output/action)

- A working prototype or wireframe showing the customer journey (e.g., a personalized dashboard, chatbot flow, or loan journey)

- An explanation of the AI/ML approach used (e.g., recommendation engines, behavioral segmentation, anomaly detection, NLP for vernacular chat)

- A note on ethical safeguards: data privacy and consent (DPDP Act, RBI data localization norms), algorithmic bias, and avoiding predatory nudging (e.g., not over-recommending loans to financially stressed customers)

## Judging Criteria:

- Innovation and technical feasibility

- Depth of personalization vs. genuine customer benefit (not just upsell-driven)

- Explainability and RBI/regulatory compliance readiness

- Usability for non-tech-savvy and vernacular-first users

- Scalability across a bank's existing digital infrastructure and social/financial impact
