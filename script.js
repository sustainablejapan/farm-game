// --- Imports ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, setDoc, onSnapshot, deleteDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- Global State & Config ---
let db = null;
let auth = null;
let userId = 'anonymous';
let simulationRef = null;

// NOTE: Global configuration constants
const appId = 'farmer-burden-game';
const firebaseConfig = {}; // Placeholder for your actual Firebase config
const initialAuthToken = null;

const MAX_WEEKS = 24; 
const PROGRESS_DELAY = 1500; // 1.5 seconds delay for progress screen

window.gameState = {
    status: 'setup', 
    setupPhase: 0, // 0: Name, 1: Location, 2: Farm Type, 3: Business Structure
    money: 100000,
    debt: 0, 
    environment: 50,
    healthRisk: 10,
    farmName: null, 
    farmType: null,
    location: null,
    businessStructure: null,
    infrastructureLevel: 20, 
    climateResilience: 10, 
    hiddenPestRisk: 0, 
    hiddenStress: 0,
    pendingDecision: null, 
    currentDecisionIndex: 0, 
    developmentStatus: 'N/A',
};

// --- LOCATION DATA (Based on FAO/CAULDRON context) ---
const LOCATION_DATA = {
    'Japan - Yakushima': {
        flag: '🇯🇵',
        name: 'Yakushima, Japan',
        soil: 'Humic Andosol (Volcanic Ash, High P-Fixation)',
        climate: 'Monsoon/High Humidity',
        developmentStatus: 'Developed',
        startingDebt: 60000,
        initialMoneyPenalty: 30000,
        basePestRisk: 15,
        initialResilience: 25,
        initialInfrastructure: 50,
        commonCrops: ['Tankan Citrus', 'Tea', 'Rice (Paddy)'],
    },
    'Central Asia - Steppe': {
        flag: '🇰🇿',
        name: 'Kazakh Steppe',
        soil: 'Chernozem / Kastanozem (Dry Steppe)',
        climate: 'Semi-arid Continental',
        developmentStatus: 'Developing',
        startingDebt: 50000,
        initialMoneyPenalty: 20000,
        basePestRisk: -10, 
        initialResilience: 10,
        initialInfrastructure: 15,
        commonCrops: ['Wheat', 'Alfalfa', 'Cattle'],
    },
    'East Africa - Highlands': {
        flag: '🇰🇪',
        name: 'Kenyan Highlands',
        soil: 'Nitosols (Deep Red Clay)',
        climate: 'Tierra Fría (Highland)',
        developmentStatus: 'Developing',
        startingDebt: 35000,
        initialMoneyPenalty: 10000,
        basePestRisk: 5,
        initialResilience: 20,
        initialInfrastructure: 10,
        commonCrops: ['Coffee', 'Maize', 'Beans'],
    },
    'Siberia - Taiga': {
        flag: '🇷🇺',
        name: 'Siberian Taiga',
        soil: 'Gelic Cambisol / Dystric Podzoluvisol (Permafrost)',
        climate: 'Cold Continental Taiga',
        developmentStatus: 'Developed',
        startingDebt: 20000,
        initialMoneyPenalty: 10000,
        basePestRisk: -20, 
        initialResilience: 5,
        initialInfrastructure: 10,
        commonCrops: ['Larch (Forestry)', 'Potatoes', 'Hay'],
    },
};

// --- GAME DECISION DATA (Simplified for brevity) ---
const decisionData = [
    // Week 2: Inputs & Resources (Fertilization Trade-Off)
    {
        week: 2,
        category: "🌱 4. Inputs & Resources",
        prompt: "Your soil test is back. What nutrient strategy will you deploy for the season?",
        choices: [
            {
                text: "Go all-in on cheap, high-synthetic urea (The 'Chemical Rush').",
                consequence: { money: -15000, environment: -20, healthRisk: 15, hiddenPestRisk: 10, narrative: "You saved capital, but the land screams for justice. This guarantees quick growth but kills soil life." }
            },
            {
                text: "Use a balanced, high-quality conventional blend with some micronutrients.",
                consequence: { money: -25000, environment: -5, healthRisk: 5, hiddenPestRisk: 5, narrative: "Moderate expense and moderate risk. A pragmatic, uninspired approach." }
            },
            {
                text: "Invest heavily in regenerative organic amendments and cover crops (The 'Dirt Hippie').",
                consequence: { money: -40000, environment: 25, healthRisk: -10, hiddenPestRisk: -10, hiddenStress: 15, narrative: "A massive expenditure, but your soil organisms are thriving. This strains cash flow but buys long-term resilience." }
            },
            {
                text: "Buy cheap fertilizer and *tell* customers it's organic (The 'Marketing Ploy').",
                consequence: { money: -5000, environment: -5, healthRisk: 25, hiddenStress: 10, narrative: "Huge short-term profit, but if the local press finds out, your reputation is ruined." }
            }
        ]
    },
    
    // Week 6: Subsidy, Environment, & Land Use (NEW MAJOR DECISION)
    {
        week: 6,
        category: "🌍 9. Environment & Subsidy Packages",
        prompt: "The government offers a new environmental subsidy package. Do you enroll, sacrificing usable land for payments?",
        choices: [
            {
                text: "Accept the Full Gold Tier: Dedicate 20% of land to non-productive biodiversity (Max Subsidy).",
                consequence: { money: 30000, environment: 25, hiddenStress: -15, narrative: "Guaranteed large income stream and huge environmental points. You are now a friend to the bees and the bureaucrats." }
            },
            {
                text: "Accept the Bronze Tier: Small change in practices for minimal payments.",
                consequence: { money: 5000, environment: 5, hiddenStress: -5, narrative: "Easy compliance and a small cheque. No real impact, but you ticked the box." }
            },
            {
                text: "Reject the Subsidy: Keep all land in production, maximize raw yield potential.",
                consequence: { money: 15000, environment: -10, hiddenStress: 10, narrative: "You bet on the market, maximizing crop space. Higher risk and stress, but potentially massive profits if the harvest is perfect." }
            },
            {
                text: "Enroll, but illegally farm the dedicated subsidy land anyway (The 'Double Dip').",
                consequence: { money: 45000, environment: -50, hiddenStress: 50, narrative: "If you are caught, the fines and legal fees will destroy you. If not, maximum illegal profit." }
            }
        ]
    },

    // Week 12: Operations & Management (Mid-Season Crisis)
    {
        week: 12,
        category: "🚨 9. Environment & Operations",
        prompt: "A severe pest outbreak requires immediate action. This is the moment of truth for your IPM strategy.",
        choices: [
            {
                text: "Blanket the field with cheap, broad-spectrum chemical spray (The 'Wipeout').",
                consequence: { money: -10000, environment: -30, healthRisk: 30, hiddenPestRisk: -40, narrative: "The pests are annihilated, but so are the beneficial insects. You guaranteed residue and long-term ecosystem collapse." }
            },
            {
                text: "Use a highly targeted, expensive, low-toxicity biopesticide.",
                consequence: { money: -25000, environment: 5, healthRisk: -10, hiddenPestRisk: -20, narrative: "A careful, costly approach. Pests are partially managed, but your ecological score is safe. A true trade-off." }
            },
            {
                text: "Do nothing and rely on natural enemies and crop resilience (The 'Zen Master').",
                consequence: { money: 0, environment: 10, healthRisk: 0, hiddenPestRisk: 30, narrative: "You saved all the money and environmental points, but the pests are feasting. Your hidden Pest Risk just soared, guaranteeing lower yield." }
            },
            {
                text: "Quickly flood the field using old, inefficient pumps to drown the pests (Only viable if you have high Infrastructure/Resilience).",
                consequence: { money: -15000, environment: -15, hiddenPestRisk: -35, infrastructureLevel: -20, narrative: "The pests are gone, but your pumps nearly died from the stress. Huge infrastructure wear and water waste." }
            }
        ]
    },
];

// --- FIREBASE AND AUTH SETUP (Standard boilerplate) ---

async function initializeFirebase() {
    try {
        if (Object.keys(firebaseConfig).length === 0) throw new Error("Firebase config missing.");
        const app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        
        await new Promise(resolve => {
            const unsubscribe = onAuthStateChanged(auth, async (user) => {
                if (user) { userId = user.uid; } 
                else if (initialAuthToken) { await signInWithCustomToken(auth, initialAuthToken); } 
                else { await signInAnonymously(auth); }
                
                userId = auth.currentUser?.uid || crypto.randomUUID();
                unsubscribe();
                resolve();
            });
        });

        startStateListener();
        
    } catch (error) {
        console.error("Firebase initialization failed. Using local mode.", error);
        window.renderGame(); 
    }
}

function startStateListener() {
    const userIdDisplay = document.getElementById('user-id-display');
    if(userIdDisplay) {
         userIdDisplay.textContent = `User ID: ${userId}`;
    }
    
    simulationRef = doc(db, 'artifacts', appId, 'users', userId, 'game_sessions', 'current_session');
    
    onSnapshot(simulationRef, (docSnap) => {
        if (docSnap.exists() && docSnap.data().status !== 'setup') {
            window.gameState = docSnap.data();
            window.displayMessage(`Game state loaded for ${window.gameState.farmName}. Welcome back!`, 'green');
        }
        window.renderGame(); 
    }, (error) => {
        console.error("Error listening to Firestore:", error);
        window.renderGame();
    });
}

window.saveStateToFirestore = async function() {
    if (!simulationRef) return;
    try {
        await setDoc(simulationRef, window.gameState, { merge: false });
    } catch (error) {
        console.error("Error saving state to Firestore:", error);
    }
}

// --- UI UTILITY FUNCTIONS ---

window.displayMessage = function(text, type = 'blue') {
    const messageEl = document.getElementById('notification-box');
    if (!messageEl) {
         return;
    }
    let colorClass = `bg-${type}-600`;
    if (type === 'green') colorClass = 'bg-green-600';
    else if (type === 'red') colorClass = 'bg-red-600';
    else if (type === 'yellow') colorClass = 'bg-yellow-600';
    else if (type === 'blue') colorClass = 'bg-blue-600';

    messageEl.innerHTML = `<div class="p-3 text-sm font-semibold text-white ${colorClass} rounded-lg mb-4 transition-opacity duration-300">${text}</div>`;
    messageEl.classList.remove('opacity-0');
    messageEl.classList.add('opacity-100');

    setTimeout(() => {
        messageEl.classList.remove('opacity-100');
        messageEl.classList.add('opacity-0');
    }, 6000);
}

window.updateMeters = function() {
    const state = window.gameState;
    
    state.environment = Math.max(0, Math.min(100, state.environment));
    state.healthRisk = Math.max(0, Math.min(100, state.healthRisk));
    state.hiddenStress = Math.max(0, Math.min(100, state.hiddenStress));
    state.infrastructureLevel = Math.max(0, Math.min(100, state.infrastructureLevel));
    state.climateResilience = Math.max(0, Math.min(100, state.climateResilience));


    // Money
    document.getElementById('money-score').textContent = `$${state.money.toLocaleString()}`;
    document.getElementById('money-score').className = state.money < 50000 ? 'metric-value text-red-600' : 'metric-value text-green-600';

    // Environment
    const envWidth = state.environment;
    document.getElementById('env-meter').style.width = `${envWidth}%`;
    document.getElementById('env-meter').className = `meter bg-${envWidth < 30 ? 'red' : envWidth < 70 ? 'yellow' : 'green'}-500`;
    document.getElementById('env-status').textContent = `${envWidth}%`;

    // Health Risk (Farmer Stress) - higher is worse
    const healthWidth = 100 - state.hiddenStress; // Invert for meter (High number = good)
    document.getElementById('health-meter').style.width = `${healthWidth}%`;
    document.getElementById('health-meter').className = `meter bg-${healthWidth < 30 ? 'red' : healthWidth < 70 ? 'yellow' : 'green'}-500`;
    document.getElementById('health-status').textContent = `${state.hiddenStress}%`; 
};

window.formatConsequence = function(c) {
    let parts = [];
    if (c.money) parts.push(`💰 Money: ${c.money > 0 ? '+$' : '-$'}${Math.abs(c.money).toLocaleString()}`);
    if (c.debt) parts.push(`🏦 Debt: +$${Math.abs(c.debt).toLocaleString()}`);
    if (c.environment) parts.push(`🌿 Environment: ${c.environment > 0 ? '+' : '-'}${Math.abs(c.environment)}`);
    if (c.healthRisk) parts.push(`🤕 Consumer Risk: ${c.healthRisk > 0 ? '+' : '-'}${Math.abs(c.healthRisk)}`);
    if (c.hiddenStress) parts.push(`😟 Farmer Stress: ${c.hiddenStress > 0 ? '+' : '-'}${Math.abs(c.hiddenStress)}`);
    return parts.join(' | ');
}

// --- CHANCE CARD DATA ---
const randomEvents = [
    // ... (events remain the same)
];

const FAKE_NEWS_HEADLINES = [
    // ... (Headlines remain the same)
];

const progressMessages = [
    // ... (Messages remain the same)
];

window.renderProgressScreen = function(week, decisionConsequences = null) {
    let mainContent = progressMessages[Math.floor(Math.random() * progressMessages.length)];
    let headlineContent = '';

    // Check for "Fake News" or Major Crisis Headline
    if (decisionConsequences) {
        for (const news of FAKE_NEWS_HEADLINES) {
            if (news.condition(decisionConsequences)) {
                
                window.gameState.money += news.penalty.money;
                window.gameState.healthRisk += news.penalty.healthRisk || 0;
                window.gameState.hiddenStress += news.penalty.hiddenStress || 0;

                headlineContent = `
                    <div class="mt-6 p-4 bg-red-100 border-l-4 border-red-500 rounded-lg shadow-inner w-full">
                        <p class="font-black text-red-800 text-xl">BREAKING LOCAL NEWS:</p>
                        <p class="text-red-700 font-bold">${news.headline}</p>
                        <p class="text-xs text-red-600 mt-1">Immediate Penalty: $${Math.abs(news.penalty.money).toLocaleString()} and Reputation Hit.</p>
                    </div>
                `;
                break;
            }
        }
    }
    
    return `
        <div class="progress-screen-content">
            <h2 class="text-3xl font-black text-gray-800 mb-4">Week ${week} Progress Check</h2>
            <p class="text-4xl mb-4">${mainContent.emoji}</p>
            <p class="text-xl text-blue-600 mb-8 loading-dots">${mainContent.text}</p>
            <div class="w-full bg-gray-200 rounded-full h-2">
                <div class="bg-teal-500 h-2 rounded-full animate-pulse" style="width: 100%;"></div>
            </div>
            ${headlineContent}
            <p class="text-sm text-gray-500 mt-4">Time is money. Progress is slow.</p>
        </div>
    `;
};


// --- GAME ACTIONS ---

window.advanceTurn = function(decisionConsequences = null) {
    const state = window.gameState;
    
    const progressPanel = document.getElementById('progress-panel');
    const decisionPanel = document.getElementById('decision-selection-panel');
    const previewPanel = document.getElementById('consequence-preview-panel');
    
    // 1. Show Progress Screen
    decisionPanel.innerHTML = '';
    previewPanel.classList.add('hidden');
    progressPanel.classList.remove('hidden');
    progressPanel.classList.add('flex', 'flex-col'); 
    progressPanel.innerHTML = window.renderProgressScreen(state.week + 1, decisionConsequences);


    setTimeout(() => {
        // 2. Advance Game State
        state.week++;

        state.money -= 500; 
        state.environment = Math.max(0, state.environment - 1); 
        
        // Debt Interest Payment (Every 4 weeks is roughly monthly)
        if (state.debt > 0 && state.week % 4 === 0) {
            const interest = Math.round(state.debt * 0.015); 
            state.money -= interest;
            window.displayMessage(`🚨 DEBT ALERT: -$${interest.toLocaleString()} deducted for loan interest!`, 'red');
        }

        // --- CHANCE CARD / RANDOM EVENT ---
        if (!decisionData.some(d => d.week === state.week) && state.week > 1) {
            let triggered = false;
            for (const event of randomEvents) {
                if (event.condition(state) && Math.random() < event.risk) {
                    const c = event.consequence;
                    state.money += c.money || 0;
                    state.hiddenPestRisk = Math.max(0, Math.min(100, state.hiddenPestRisk + (c.hiddenPestRisk || 0)));
                    state.hiddenStress = Math.max(0, Math.min(100, state.hiddenStress + (c.hiddenStress || 0)));
                    state.infrastructureLevel = Math.max(0, Math.min(100, state.infrastructureLevel + (c.infrastructureLevel || 0)));
                    window.displayMessage(`⚠️ EVENT: ${c.narrative}`, 'yellow');
                    triggered = true;
                    break;
                }
            }
            
            if (!triggered) {
                 const basePestChange = (Math.random() - 0.5) * 10;
                 state.hiddenPestRisk = Math.max(0, Math.min(100, state.hiddenPestRisk + basePestChange));
            }
        }

        // 3. Render Next State (Decision or Monitoring)
        progressPanel.classList.add('hidden');
        progressPanel.classList.remove('flex', 'flex-col'); 
        window.renderGame();

    }, PROGRESS_DELAY);
}

window.selectDecisionOption = function(week, choiceIndex) {
    const decision = decisionData.find(d => d.week === week);
    if (!decision) return;

    // Store the pending decision and update the UI
    window.gameState.pendingDecision = { week, choiceIndex };
    const choice = decision.choices[choiceIndex];
    const previewPanel = document.getElementById('consequence-preview-panel');
    
    // Remove highlight from old button and add to current
    document.querySelectorAll('.choice-button').forEach(btn => btn.classList.remove('selected'));
    document.querySelector(`#choice-btn-${choiceIndex}`).classList.add('selected');

    const c = choice.consequence;

    // Populate the preview panel with CONFIRM and NEXT buttons
    previewPanel.classList.remove('hidden');
    previewPanel.innerHTML = `
        <p class="text-lg font-bold text-gray-800 mb-2">Consequence Preview:</p>
        <p class="text-sm text-blue-600 mb-4">${choice.consequence.narrative}</p>
        <p class="text-sm font-semibold mb-3">TRADE-OFFS:</p>
        <ul class="space-y-1 text-sm text-gray-700">
            <li>${window.formatConsequence(c)}</li>
        </ul>
        <div class="mt-4 flex space-x-2">
            <button onclick="window.processPendingDecision()" class="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-2 rounded-lg transition">
                ACCEPT THIS OPTION
            </button>
            <button onclick="window.cycleDecisionOption()" class="flex-1 bg-gray-400 hover:bg-gray-500 text-white font-bold py-2 rounded-lg transition">
                SEE NEXT OPTION
            </button>
        </div>
    `;
}

window.processPendingDecision = function() {
    const pending = window.gameState.pendingDecision;
    if (!pending) return;

    const decision = decisionData.find(d => d.week === pending.week);
    const choice = decision.choices[pending.choiceIndex];
    const c = choice.consequence;
    const state = window.gameState;

    // Store the consequences before applying to pass to advanceTurn for NEWS CHECK
    const appliedConsequences = JSON.parse(JSON.stringify(c));

    // Apply consequences
    state.money += c.money || 0;
    state.debt += c.debt || 0; 
    state.environment += c.environment || 0;
    state.healthRisk += c.healthRisk || 0;
    state.hiddenPestRisk = Math.max(0, Math.min(100, state.hiddenPestRisk + (c.hiddenPestRisk || 0)));
    state.hiddenStress = Math.max(0, Math.min(100, state.hiddenStress + (c.hiddenStress || 0)));
    state.infrastructureLevel = Math.max(0, Math.min(100, state.infrastructureLevel + (c.infrastructureLevel || 0))); 
    state.climateResilience = Math.max(0, Math.min(100, state.climateResilience + (c.climateResilience || 0))); 

    window.gameState.pendingDecision = null;
    window.gameState.currentDecisionIndex = 0; // Reset index for next event
    window.displayMessage(`Decision processed: ${choice.text}`, c.money > 0 ? 'green' : 'red');

    // Advance turn, passing the consequences for the News Check
    window.advanceTurn(appliedConsequences);
}

window.cycleDecisionOption = function() {
    const decision = decisionData.find(d => d.week === window.gameState.week);
    if (!decision) return;

    let nextIndex = (window.gameState.currentDecisionIndex + 1) % decision.choices.length;
    window.gameState.currentDecisionIndex = nextIndex;
    
    // Clear preview panel and re-render the decision prompt with the next option
    document.getElementById('consequence-preview-panel').classList.add('hidden');
    window.renderDecisionPrompt(window.gameState.week);
}

window.renderDecisionPrompt = function(week) {
    const decision = decisionData.find(d => d.week === week);
    const selectionPanel = document.getElementById('decision-selection-panel');
    const index = window.gameState.currentDecisionIndex;
    const choice = decision.choices[index];

    // Clear and build content
    selectionPanel.innerHTML = `
        <p class="text-sm font-black text-amber-600 mb-2">${decision.category}</p>
        <h2 class="text-3xl font-black text-gray-800 mb-6">${decision.prompt}</h2>
        <button id="choice-btn-${index}" class="choice-button" data-index="${index}">
            <span class="font-bold block text-lg">${choice.text}</span>
        </button>
        <p class="text-sm text-gray-500 mt-4">Option ${index + 1} of ${decision.choices.length}. Click button to preview trade-offs.</p>
    `;

    // Re-attach event listener (since content was overwritten)
    document.getElementById(`choice-btn-${index}`).onclick = () => window.selectDecisionOption(week, index);
}

// --- RENDERING CORE ---

window.renderGame = function() {
    const state = window.gameState;
    const content = document.getElementById('main-game-container');
    
    // --- Phase 1: Setup Flow (Conversational) ---
    if (state.status === 'setup' || state.setupPhase < 4) {
        document.body.className = '';
        content.innerHTML = window.renderSetupPhase();
        // Attach listener for the main content area after rendering
        document.getElementById('content-container').onclick = (e) => {
            if (e.target.classList.contains('setup-button')) {
                window.advanceSetupPhase();
            } else if (e.target.classList.contains('setup-choice')) {
                // Handle dynamic choice selection
                const target = e.target.closest('.setup-choice');
                if (target) {
                    const group = target.dataset.group;
                    const value = target.dataset.value;
                    // Reset all other buttons in the group
                    document.querySelectorAll(`.setup-choice[data-group="${group}"]`).forEach(btn => btn.classList.remove('selected'));
                    target.classList.add('selected');
                    // Store the value temporarily
                    window.gameState[group] = value;
                    window.renderGame(); // Re-render to update info panels
                }
            }
        };
        return;
    }

    // --- Phase 2: Game Layout Check ---
    const playingMain = document.getElementById('playing-main');
    if (!playingMain || state.week === 0) {
        content.innerHTML = window.renderPlayingLayout(state);
    }
    
    // --- Phase 3: Update Metrics and Content ---
    
    if (document.getElementById('playing-main')) {
        window.updateMeters();
        document.body.className = 'p-4 md:p-8';
        
        // Update all status fields
        document.getElementById('farm-name-display').textContent = state.farmName;
        document.getElementById('current-location').textContent = state.location || 'N/A';
        document.getElementById('current-dev-status').textContent = state.developmentStatus || 'N/A';
        document.getElementById('current-biz').textContent = state.businessStructure || 'N/A';
        document.getElementById('week-counter').textContent = `Week ${state.week} of ${MAX_WEEKS}`;
        document.getElementById('current-infra').textContent = `${state.infrastructureLevel}%`;
        document.getElementById('current-resilience').textContent = `${state.climateResilience}%`;
        document.getElementById('current-debt').textContent = `$${state.debt.toLocaleString()}`;


        if (state.week > MAX_WEEKS) {
            state.status = 'end';
            window.renderEndGame();
            return;
        }

        // Find current decision
        const currentDecision = decisionData.find(d => d.week === state.week);
        
        // Hide progress screen if it's still showing
        document.getElementById('progress-panel').classList.add('hidden');
        document.getElementById('progress-panel').classList.remove('flex', 'flex-col'); 


        if (currentDecision) {
            // Decision Screen - Use the new single-choice renderer
            document.getElementById('consequence-preview-panel').classList.add('hidden');
            document.getElementById('decision-selection-panel').classList.remove('hidden');
            window.renderDecisionPrompt(state.week);
        } else {
            // Monitoring/No decision week
            const pestMessage = state.hiddenPestRisk > 70 ? "Pest and disease pressures are spiking! Your crop is visibly unhappy and posting vague complaints on social media." : "Routine monitoring shows stable conditions. The field looks resilient, but the critics are waiting.";
            const stressChange = state.hiddenStress > 50 ? "Your stress is high; you snapped at the weather forecast and a bookkeeping error cost you $2,000." : "A quiet week; you feel organized and briefly achieved true inner peace (for 15 minutes).";
            
            document.getElementById('consequence-preview-panel').classList.add('hidden');
            document.getElementById('decision-selection-panel').classList.remove('hidden');
            document.getElementById('decision-selection-panel').innerHTML = `
                <h2 class="text-3xl font-black text-gray-800 mb-6">Week ${state.week}: Maintenance & Monitoring</h2>
                <div class="space-y-4">
                    <p class="p-4 bg-gray-100 text-gray-700 rounded-lg font-semibold">
                        <span class="text-xl text-blue-600">🐞 Observation:</span> ${pestMessage}
                    </p>
                    <p class="p-4 bg-gray-100 text-gray-700 rounded-lg font-semibold">
                        <span class="text-xl text-blue-600">📋 Farm Report:</span> ${stressChange}
                    </p>
                </div>
                <button onclick="window.advanceTurn()" class="mt-8 w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-xl transition duration-150 ease-in-out">
                    Continue to Next Week (Week ${state.week + 1})
                </button>`;
        }
    }

    window.saveStateToFirestore();
};

// --- SETUP PHASE FLOW ---

window.renderSetupPhase = function() {
    const phase = window.gameState.setupPhase;
    const state = window.gameState;
    let title, contentHtml, buttonText;
    
    // --- PHASE 0: Intro & Name ---
    if (phase === 0) {
        title = "Welcome! I am FARM-OS 3000. What would you like to call your farm?";
        contentHtml = `
            <p class="text-gray-600 mb-6">Your quest is to manage the ultimate modern farming conflict: **Profit vs. Planet vs. Peace of Mind**.</p>
            <label class="block text-sm font-medium text-gray-700 mb-2">Farm Name (e.g., Doom Acres):</label>
            <input type="text" id="farm-name-input" placeholder="Name your doomed farm..." class="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 setup-input" required value="${state.farmName || ''}">
        `;
        buttonText = "CONFIRM NAME";
    }

    // --- PHASE 1: Location Selection (Click Boxes) ---
    else if (phase === 1) {
        title = `Perfect, ${state.farmName}. Now, where in the world will you operate?`;
        
        const locationButtons = Object.entries(LOCATION_DATA).map(([key, data]) => {
            const isSelected = key === state.location ? 'selected' : '';
            return `
                <button class="choice-button setup-choice flag-button ${isSelected}" data-group="location" data-value="${key}">
                    ${data.flag} ${data.name} 
                    <span class="setup-info">${data.climate} | Role: ${data.developmentStatus}</span>
                </button>
            `;
        }).join('');
        
        const selectedData = LOCATION_DATA[state.location] || null;

        contentHtml = `
            <p class="text-gray-600 mb-4">Your **starting debt, infrastructure, and climate risks** are set by your location. Choose below:</p>
            <div class="space-y-3 mb-4">${locationButtons}</div>
            ${selectedData ? `
            <div class="p-3 bg-teal-50 border-l-4 border-teal-500 rounded">
                <p class="font-bold text-teal-800">Reality Check:</p>
                <p class="text-sm text-gray-700">Soil: ${selectedData.soil} | Starting Debt: $${selectedData.startingDebt.toLocaleString()}</p>
            </div>` : `<p class="text-red-500 font-bold">Click a location to see its details and risks.</p>`}
        `;
        buttonText = "CONFIRM LOCATION";
    } 
    
    // --- PHASE 2: Farm Type & Urban Status (Click Boxes) ---
    else if (phase === 2) {
        const locationData = LOCATION_DATA[state.location];
        
        title = `In ${locationData.name} (${locationData.soil}), what will you focus on?`;
        contentHtml = `
            <p class="text-gray-600 mb-4">Choose your primary focus and immediate neighborhood type:</p>
            
            <div class="grid grid-cols-2 gap-4 mb-4">
                <button class="choice-button setup-choice ${state.farmType === 'Crop - Grains' ? 'selected' : ''}" data-group="farmType" data-value="Crop - Grains">
                    🌾 Grains & Row Crops
                </button>
                <button class="choice-button setup-choice ${state.farmType === 'Livestock - Cattle' ? 'selected' : ''}" data-group="farmType" data-value="Livestock - Cattle">
                    🐄 Livestock & Pasture
                </button>
                <button class="choice-button setup-choice ${state.farmType === 'Mixed - Veg/Poultry' ? 'selected' : ''}" data-group="farmType" data-value="Mixed - Veg/Poultry">
                    🐔 Mixed Farming
                </button>
            </div>
            
            <label class="block text-sm font-medium text-gray-700 mb-2">Neighborhood Type (Affects regulation/land cost):</label>
            <div class="grid grid-cols-2 gap-4">
                <button class="choice-button setup-choice ${state.urbanStatus === 'Rural' ? 'selected' : ''}" data-group="urbanStatus" data-value="Rural">
                    🏞️ RURAL/REMOTE
                </button>
                <button class="choice-button setup-choice ${state.urbanStatus === 'Urban' ? 'selected' : ''}" data-group="urbanStatus" data-value="Urban">
                    🏙️ URBAN FRINGE
                </button>
            </div>
        `;
        buttonText = "CONFIRM PRODUCTION";
    }
    
    // --- PHASE 3: Business Structure (FINAL SETUP) ---
    else if (phase === 3) {
        title = `Final step: What is your business structure?`;
        contentHtml = `
            <p class="text-gray-600 mb-4">Choose your liability and management style.</p>
            <div class="space-y-4">
                <button class="choice-button setup-choice ${state.businessStructure === 'Sole Trader' ? 'selected' : ''}" data-group="businessStructure" data-value="Sole Trader">
                    👤 Sole Trader (High Risk/High Stress)
                </button>
                <button class="choice-button setup-choice ${state.businessStructure === 'Family Run' ? 'selected' : ''}" data-group="businessStructure" data-value="Family Run">
                    👨‍👩‍👧 Family Run (Moderate Risk/Disputes)
                </button>
                <button class="choice-button setup-choice ${state.businessStructure === 'Cooperative' ? 'selected' : ''}" data-group="businessStructure" data-value="Cooperative">
                    🤝 Cooperative (Low Risk/Slow Decisions)
                </button>
            </div>
        `;
        buttonText = "FINALIZE & START SEASON";
    }

    // Wrap the content in the main container for the conversational style
    return `
        <div id="content-container" class="p-8">
            <div class="flex items-center justify-center">
                <div id="main-content-area" class="w-full max-w-2xl">
                    <h2 class="game-title text-center mb-6">${window.gameState.farmName ? window.gameState.farmName : "FARMING SIMULATOR"}</h2>
                    <div class="dialogue-box">
                        <p class="computer-text">${title}</p>
                    </div>
                    <div id="setup-form-panel" class="bg-white p-6 rounded-xl shadow-lg mt-4">
                        ${contentHtml}
                    </div>
                    <button class="action-button setup-button mt-4">
                        ${buttonText}
                    </button>
                </div>
            </div>
        </div>
    `;
}

window.startGameSetup = function() {
    // This is the function that runs on FINAL CONFIRMATION
    const state = window.gameState;
    
    // --- FINAL VALIDATION CHECK ---
    if (!state.farmName || !state.location || !state.farmType || !state.businessStructure) {
         window.displayMessage("Please complete all setup steps before starting the season.", 'red');
        return;
    }

    // --- FINAL CALCULATIONS ---
    const locationData = LOCATION_DATA[state.location];

    // Apply starting conditions based on confirmed choices
    state.money = 100000 - locationData.initialMoneyPenalty; 
    state.debt = locationData.startingDebt;
    state.climateResilience = locationData.initialResilience;
    state.infrastructureLevel = locationData.initialInfrastructure;
    state.hiddenPestRisk = locationData.basePestRisk;
    
    // Apply Modifiers
    if (state.urbanStatus === 'Urban') { state.money -= 10000; state.hiddenStress += 15; state.infrastructureLevel += 10; }
    if (state.farmType.includes('Mixed')) { state.hiddenStress += 20; }
    if (state.businessStructure.includes('Sole Trader')) { state.hiddenStress += 10; }
    if (state.businessStructure.includes('Cooperative')) { state.money -= 10000; state.hiddenStress -= 10; }

    state.setupPhase = 4;
    state.status = 'playing';
    window.displayMessage(`Season started in ${state.location}! Role: ${state.developmentStatus}`, 'green');
    window.advanceTurn(); 
}

window.advanceSetupPhase = function() {
    const state = window.gameState;
    
    // --- Phase 0: Name Input ---
    if (state.setupPhase === 0) {
        const input = document.getElementById('farm-name-input');
        const name = input ? input.value.trim() : '';
        if (!name) {
            window.displayMessage("Please enter a name for your farm.", 'red');
            return;
        }
        state.farmName = name;
        state.setupPhase = 1;
    } 
    
    // --- Phase 1: Location Selection ---
    else if (state.setupPhase === 1) {
        if (!state.location) {
             window.displayMessage("Please click on a location box to select where you will farm.", 'red');
            return;
        }
        state.setupPhase = 2;
    } 
    
    // --- Phase 2: Farm Type & Urban Status ---
    else if (state.setupPhase === 2) {
        if (!state.farmType || !state.urbanStatus) {
             window.displayMessage("Please click one option for Production Type and one for Neighborhood Type.", 'red');
            return;
        }
        state.setupPhase = 3;
    }
    
    // --- Phase 3: Business Structure (Leads to FINAL START) ---
    else if (state.setupPhase === 3) {
        if (!state.businessStructure) {
             window.displayMessage("Please click one option for Business Structure.", 'red');
            return;
        }
        // If everything is selected, jump to the final start function
        window.startGameSetup();
        return; 
    }

    window.renderGame(); 
}

// (The rest of the rendering and game logic remains the same, using the new conversational flow)

window.renderGame = function() {
    const state = window.gameState;
    const content = document.getElementById('main-game-container');
    
    // --- Phase 1: Setup Flow (Conversational) ---
    if (state.status === 'setup' || state.setupPhase < 3) {
        document.body.className = '';
        content.innerHTML = window.renderSetupPhase();
        // Attach listener for the main content area after rendering
        document.getElementById('content-container').onclick = (e) => {
            const target = e.target.closest('.setup-choice, .setup-button');
            if (target && target.classList.contains('setup-button')) {
                window.advanceSetupPhase();
            } else if (target && target.classList.contains('setup-choice')) {
                const group = target.dataset.group;
                const value = target.dataset.value;
                // Reset all other buttons in the group
                document.querySelectorAll(`.setup-choice[data-group="${group}"]`).forEach(btn => btn.classList.remove('selected'));
                target.classList.add('selected');
                // Store the value temporarily
                window.gameState[group] = value;
                window.renderGame(); // Re-render to update info panels
            }
        };
        return;
    }

    // --- Phase 2: Game Layout Check ---
    const playingMain = document.getElementById('playing-main');
    if (!playingMain || state.week === 0) {
        content.innerHTML = window.renderPlayingLayout(state);
    }
    
    // --- Phase 3: Update Metrics and Content ---
    
    if (document.getElementById('playing-main')) {
        window.updateMeters();
        document.body.className = 'p-4 md:p-8';
        
        // Update all status fields
        document.getElementById('farm-name-display').textContent = state.farmName;
        document.getElementById('current-location').textContent = state.location || 'N/A';
        document.getElementById('current-dev-status').textContent = state.developmentStatus || 'N/A';
        document.getElementById('current-biz').textContent = state.businessStructure || 'N/A';
        document.getElementById('week-counter').textContent = `Week ${state.week} of ${MAX_WEEKS}`;
        document.getElementById('current-infra').textContent = `${state.infrastructureLevel}%`;
        document.getElementById('current-resilience').textContent = `${state.climateResilience}%`;
        document.getElementById('current-debt').textContent = `$${state.debt.toLocaleString()}`;


        if (state.week > MAX_WEEKS) {
            state.status = 'end';
            window.renderEndGame();
            return;
        }

        // Find current decision
        const currentDecision = decisionData.find(d => d.week === state.week);
        
        // Hide progress screen if it's still showing
        document.getElementById('progress-panel').classList.add('hidden');
        document.getElementById('progress-panel').classList.remove('flex', 'flex-col'); 


        if (currentDecision) {
            // Decision Screen - Use the new single-choice renderer
            document.getElementById('consequence-preview-panel').classList.add('hidden');
            document.getElementById('decision-selection-panel').classList.remove('hidden');
            window.renderDecisionPrompt(state.week);
        } else {
            // Monitoring/No decision week
            const pestMessage = state.hiddenPestRisk > 70 ? "Pest and disease pressures are spiking! Your crop is visibly unhappy and posting vague complaints on social media." : "Routine monitoring shows stable conditions. The field looks resilient, but the critics are waiting.";
            const stressChange = state.hiddenStress > 50 ? "Your stress is high; you snapped at the weather forecast and a bookkeeping error cost you $2,000." : "A quiet week; you feel organized and briefly achieved true inner peace (for 15 minutes).";
            
            document.getElementById('consequence-preview-panel').classList.add('hidden');
            document.getElementById('decision-selection-panel').classList.remove('hidden');
            document.getElementById('decision-selection-panel').innerHTML = `
                <h2 class="text-3xl font-black text-gray-800 mb-6">Week ${state.week}: Maintenance & Monitoring</h2>
                <div class="space-y-4">
                    <p class="p-4 bg-gray-100 text-gray-700 rounded-lg font-semibold">
                        <span class="text-xl text-blue-600">🐞 Observation:</span> ${pestMessage}
                    </p>
                    <p class="p-4 bg-gray-100 text-gray-700 rounded-lg font-semibold">
                        <span class="text-xl text-blue-600">📋 Farm Report:</span> ${stressChange}
                    </p>
                </div>
                <button onclick="window.advanceTurn()" class="mt-8 w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-xl transition duration-150 ease-in-out">
                    Continue to Next Week (Week ${state.week + 1})
                </button>`;
        }
    }

    window.saveStateToFirestore();
};

// --- SETUP AND END GAME LOGIC ---

window.renderEndGame = function() {
    const state = window.gameState;

    // Final Profit Calculation: Current Money + Base Revenue - Hidden Penalties - Debt
    const initialBaseRevenue = 50000;
    const yieldPenalty = state.hiddenPestRisk * 150; 
    const resilienceBonus = state.climateResilience * 200; 
    const finalDebtPenalty = state.debt * 1.05; 
    
    const finalProfit = state.money + initialBaseRevenue + resilienceBonus - yieldPenalty - finalDebtPenalty;

    // Final Scores based on metrics
    const finalEnvScore = state.environment;
    const finalHealthScore = 100 - state.hiddenStress; 
    
    // Combined Score: Profit is heavily weighted, Infrastructure/Resilience also contributes
    const totalScore = (finalProfit / 1000) * 3 + finalEnvScore * 1.5 + finalHealthScore * 1 + state.infrastructureLevel + state.climateResilience;
    
    // NLI (National Loss Index) Calculation for CAULDRON integration
    // NLI = (Debt + Total Yield Loss Value) / Base Annual Revenue
    const nationalLossIndex = Math.round((state.debt + yieldPenalty) / initialBaseRevenue * 100);

    const legacyRank = totalScore > 850 ? "⭐️ Sustainable Titan" :
                       totalScore > 500 ? "🌟 Resilient Manager" :
                       totalScore > 200 ? "🌱 Surviving Operator" :
                       "🌪️ High Risk Venture";
    
    const endContent = document.getElementById('content-container');
    
    endContent.innerHTML = `
        <div class="p-8 text-center bg-white rounded-xl border-b-8 border-blue-700 game-card">
            <h2 class="text-4xl font-black text-blue-700 mb-2">FARM LEGACY REPORT</h2>
            <h3 class="text-2xl text-gray-800 mb-6 font-semibold">"A Season at ${state.farmName}"</h3>
            
            <div class="bg-gray-50 p-6 rounded-lg mb-6">
                <p class="text-xl font-bold text-gray-800">NEGOTIATION DATA:</p>
                <p class="text-xl font-black text-red-600 mt-1">National Loss Index (NLI): ${nationalLossIndex}%</p>
                <p class="text-lg text-gray-700 mt-2">Your Role: <span class="font-bold">${state.developmentStatus} Country</span></p>
            </div>

            <h3 class="text-5xl font-black text-gray-800 mt-8 tracking-tighter">TOTAL LEGACY SCORE: <span class="text-blue-700">${totalScore.toFixed(0)}</span></h3>
            <p class="text-sm text-gray-500 mt-2">Screenshot this score to share and compare with friends! </p>
            
            <button onclick="window.resetGame()" class="mt-8 w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-xl transition duration-150">
                START NEW FARM
            </button>
        </div>
    `;
}

window.resetGame = async function() {
    window.gameState = {
        status: 'setup',
        setupPhase: 0,
        week: 0,
        money: 100000,
        debt: 0,
        environment: 50,
        healthRisk: 10,
        farmName: null,
        farmType: null,
        location: null,
        businessStructure: null,
        infrastructureLevel: 20,
        climateResilience: 10,
        hiddenPestRisk: 0,
        hiddenStress: 0,
        pendingDecision: null,
        currentDecisionIndex: 0,
        developmentStatus: 'N/A',
    };
    window.renderGame();
    
    if (simulationRef) {
        try {
            await deleteDoc(simulationRef);
            window.displayMessage("Game state cleared. Ready for a new beginning!", 'yellow');
        } catch (e) {
             console.warn("Could not delete previous state:", e);
        }
    }
}

document.addEventListener('DOMContentLoaded', initializeFirebase);