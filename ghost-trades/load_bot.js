// ===================================
// LOAD BOT - XML CONFIGURATION LOADER
// Loads trading strategies and configurations from XML files
// ===================================

// --- Load Bot State ---
let loadBotState = {
    isLoading: false,
    loadedConfigs: {},
    currentConfig: null,
    runId: null,
    configCount: 0
};

// Global log containers (assumed to exist in the UI)
let loadBotLogContainer;
let loadBotConfigTableBody;

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    loadBotLogContainer = document.getElementById('load-bot-log-container');
    loadBotConfigTableBody = document.querySelector('#load-bot-config-table tbody');
    
    // Add event listeners for buttons
    const loadXmlButton = document.getElementById('load-xml-button');
    const loadBotToggleButtons = document.querySelectorAll('[id^="load-bot-toggle-button"]');
    const clearLoadBotHistory = document.getElementById('clear-load-bot-history');
    const xmlFileInput = document.getElementById('xmlFilePath');
    
    if (loadXmlButton) {
        loadXmlButton.addEventListener('click', async () => {
            const filePath = xmlFileInput?.value?.trim();
            if (filePath) {
                await loadAndApplyXMLConfig(filePath);
            } else {
                addLoadBotLog('⚠️ Please enter an XML file path', 'warning');
                showToast('Please enter an XML file path', 'warning');
            }
        });
    }
    
    loadBotToggleButtons.forEach(btn => {
        btn.addEventListener('click', startLoadBot);
    });
    
    if (clearLoadBotHistory) {
        clearLoadBotHistory.addEventListener('click', clearLoadBotHistory);
    }
    
    // Add file input for drag-and-drop or file selection
    createFileUploadInput();
});

/**
 * Create file upload input for XML files
 */
function createFileUploadInput() {
    const controlGroup = document.querySelector('#load-bot-interface .control-group');
    if (!controlGroup) return;
    
    const fileInputHTML = `
        <div class="control-group" style="margin-top: 10px;">
            <label for="xmlFileUpload">Or Upload XML File</label>
            <input type="file" id="xmlFileUpload" accept=".xml" style="width: 100%; padding: 8px; border: 1px solid var(--glass-border); border-radius: var(--radius-md); background: var(--glass-bg); color: var(--text-primary);">
        </div>
    `;
    
    controlGroup.insertAdjacentHTML('afterend', fileInputHTML);
    
    const fileInput = document.getElementById('xmlFileUpload');
    if (fileInput) {
        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file && file.name.endsWith('.xml')) {
                await loadXMLFromFile(file);
            } else {
                addLoadBotLog('⚠️ Please select a valid XML file', 'warning');
            }
        });
    }
}

/**
 * Add log message to load bot
 */
function addLoadBotLog(message, type = 'info') {
    const logEntry = document.createElement('div');
    const timestamp = new Date().toLocaleTimeString();
    logEntry.innerHTML = `<span>[${timestamp}]</span> ${message}`;
    logEntry.className = `log-${type}`;

    if (loadBotLogContainer) {
        loadBotLogContainer.appendChild(logEntry);
        loadBotLogContainer.scrollTop = loadBotLogContainer.scrollHeight;
    }

    console.log(`[LOAD BOT] ${message}`);
}

/**
 * Load XML from uploaded file
 */
async function loadXMLFromFile(file) {
    try {
        addLoadBotLog(`📁 Loading uploaded file: ${file.name}`, 'info');
        
        const xmlText = await file.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, 'application/xml');
        
        // Check for parse errors
        const parseError = xmlDoc.querySelector('parsererror');
        if (parseError) {
            throw new Error(`XML parse error: ${parseError.textContent}`);
        }
        
        // Extract and apply configuration
        const config = parseXMLConfig(xmlDoc, file.name);
        loadBotState.loadedConfigs[file.name] = config;
        loadBotState.configCount++;
        
        addLoadBotLog(`✅ Successfully loaded: ${config.name}`, 'success');
        addConfigToTable(config);
        
        // Apply configuration to bot
        await applyConfigToBot(config);
        
        updateLoadBotStats();
        showToast(`Configuration loaded: ${config.name}`, 'success');
        
    } catch (error) {
        addLoadBotLog(`❌ Failed to load file: ${error.message}`, 'error');
        showToast(`Failed to load XML: ${error.message}`, 'error');
    }
}

/**
 * Load XML configuration from file path
 */
async function loadXMLConfig(filePath) {
    try {
        addLoadBotLog(`📂 Loading XML config: ${filePath}`, 'info');

        const response = await fetch(filePath);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const xmlText = await response.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, 'application/xml');

        // Check for parse errors
        const parseError = xmlDoc.querySelector('parsererror');
        if (parseError) {
            throw new Error(`XML parse error: ${parseError.textContent}`);
        }

        // Extract configuration
        const config = parseXMLConfig(xmlDoc, filePath);
        loadBotState.loadedConfigs[filePath] = config;
        loadBotState.configCount++;

        addLoadBotLog(`✅ Successfully loaded config: ${config.name}`, 'success');
        addLoadBotLog(`📊 Variables: ${config.variables.length}, Blocks: ${config.blocks.length}`, 'info');
        
        addConfigToTable(config);
        updateLoadBotStats();

        return config;

    } catch (error) {
        addLoadBotLog(`❌ Failed to load ${filePath}: ${error.message}`, 'error');
        throw error;
    }
}

/**
 * Parse XML configuration into structured object
 */
function parseXMLConfig(xmlDoc, filePath) {
    const config = {
        name: filePath.split('/').pop().replace('.xml', ''),
        filePath: filePath,
        variables: [],
        blocks: [],
        procedures: [],
        tradingParams: {}
    };

    // Parse variables
    const variables = xmlDoc.querySelectorAll('variables > variable');
    const variableMap = {};
    
    variables.forEach(varEl => {
        const varData = {
            id: varEl.getAttribute('id'),
            type: varEl.getAttribute('type') || '',
            name: varEl.textContent.trim()
        };
        config.variables.push(varData);
        variableMap[varData.id] = varData.name;
    });

    // Parse blocks and extract trading parameters
    const blocks = xmlDoc.querySelectorAll('block');
    blocks.forEach(blockEl => {
        const block = parseBlock(blockEl, variableMap);
        config.blocks.push(block);
        
        // Extract trading parameters from blocks
        extractTradingParams(block, config.tradingParams, variableMap);
    });

    // Extract key trading parameters from variables
    config.tradingParams.initialStake = findVariableValue(config.variables, ['Initial Stake', 'Amount', 'Stake']);
    config.tradingParams.targetProfit = findVariableValue(config.variables, ['Target Profit', 'Profit']);
    config.tradingParams.stopLoss = findVariableValue(config.variables, ['Martingale Stop', 'Stop Loss']);
    config.tradingParams.ticksToAnalyze = findVariableValue(config.variables, ['Ticks to Analyse', 'Ticks to analyze']);
    config.tradingParams.martingaleSplits = findVariableValue(config.variables, ['Mart Splits', 'Martingale Split', 'Martingale Level']);
    config.tradingParams.payoutPercentage = findVariableValue(config.variables, ['% Win Per Stake', 'Return % Number']);

    return config;
}

/**
 * Parse a single block element
 */
function parseBlock(blockEl, variableMap) {
    const block = {
        type: blockEl.getAttribute('type'),
        id: blockEl.getAttribute('id'),
        collapsed: blockEl.getAttribute('collapsed') === 'true',
        x: parseInt(blockEl.getAttribute('x') || 0),
        y: parseInt(blockEl.getAttribute('y') || 0),
        fields: {},
        values: {},
        statements: {},
        next: null
    };

    // Extract fields
    const fields = blockEl.querySelectorAll(':scope > field');
    fields.forEach(fieldEl => {
        const fieldName = fieldEl.getAttribute('name');
        const fieldValue = fieldEl.textContent;
        const varId = fieldEl.getAttribute('id');
        
        block.fields[fieldName] = {
            value: fieldValue,
            varName: varId ? variableMap[varId] : null
        };
    });

    // Extract values
    const values = blockEl.querySelectorAll(':scope > value');
    values.forEach(valueEl => {
        const name = valueEl.getAttribute('name');
        const childBlock = valueEl.querySelector(':scope > block');
        if (childBlock) {
            block.values[name] = parseBlock(childBlock, variableMap);
        }
    });

    // Extract statements
    const statements = blockEl.querySelectorAll(':scope > statement');
    statements.forEach(stmtEl => {
        const name = stmtEl.getAttribute('name');
        const childBlock = stmtEl.querySelector(':scope > block');
        if (childBlock) {
            block.statements[name] = parseBlock(childBlock, variableMap);
        }
    });

    // Extract next block
    const nextEl = blockEl.querySelector(':scope > next > block');
    if (nextEl) {
        block.next = parseBlock(nextEl, variableMap);
    }

    return block;
}

/**
 * Extract trading parameters from blocks
 */
function extractTradingParams(block, params, variableMap) {
    if (!block) return;
    
    // Look for variable assignments
    if (block.type === 'variables_set' && block.fields.VAR) {
        const varName = block.fields.VAR.varName;
        const value = extractBlockValue(block.values.VALUE);
        
        if (varName && value !== null) {
            params[varName] = value;
        }
    }
    
    // Look for trade parameters in purchase blocks
    if (block.type === 'purchase' || block.type === 'trade') {
        if (block.values.AMOUNT) {
            params.tradeAmount = extractBlockValue(block.values.AMOUNT);
        }
        if (block.values.PREDICTION) {
            params.prediction = extractBlockValue(block.values.PREDICTION);
        }
    }
    
    // Recursively check nested blocks
    Object.values(block.values).forEach(val => {
        if (val && typeof val === 'object') {
            extractTradingParams(val, params, variableMap);
        }
    });
    
    Object.values(block.statements).forEach(stmt => {
        if (stmt && typeof stmt === 'object') {
            extractTradingParams(stmt, params, variableMap);
        }
    });
    
    if (block.next) {
        extractTradingParams(block.next, params, variableMap);
    }
}

/**
 * Extract value from a block
 */
function extractBlockValue(block) {
    if (!block) return null;
    
    if (block.type === 'math_number' && block.fields.NUM) {
        return parseFloat(block.fields.NUM.value);
    }
    
    if (block.type === 'text' && block.fields.TEXT) {
        return block.fields.TEXT.value;
    }
    
    if (block.type === 'variables_get' && block.fields.VAR) {
        return block.fields.VAR.varName;
    }
    
    return null;
}

/**
 * Find variable value by name
 */
function findVariableValue(variables, possibleNames) {
    for (const name of possibleNames) {
        const variable = variables.find(v => v.name === name);
        if (variable) {
            return variable.name;
        }
    }
    return null;
}

/**
 * Add configuration to table
 */
function addConfigToTable(config) {
    if (!loadBotConfigTableBody) return;
    
    const row = loadBotConfigTableBody.insertRow(0);
    row.innerHTML = `
        <td style="font-weight: 600;">${config.name}</td>
        <td>${config.variables.length}</td>
        <td>${config.blocks.length}</td>
        <td>${config.procedures.length}</td>
        <td><span class="price-up">✓ Loaded</span></td>
    `;
}

/**
 * Apply loaded configuration to Ghost AI bot
 */
async function applyConfigToBot(config) {
    addLoadBotLog(`🔧 Applying configuration to Ghost AI Bot...`, 'info');
    
    try {
        // Map XML parameters to Ghost AI bot parameters
        const botParams = mapXMLToBotParams(config);
        
        // Update Ghost AI bot UI inputs
        updateGhostAIInputs(botParams);
        
        addLoadBotLog(`✅ Configuration applied successfully`, 'success');
        addLoadBotLog(`📊 Stake: $${botParams.initialStake} | Target: $${botParams.targetProfit} | Analysis: ${botParams.analysisDigits} ticks`, 'info');
        
        showToast('Bot configuration loaded successfully!', 'success');
        
        // Optionally auto-start the bot
        const autoStart = confirm(`Configuration loaded!\n\nStake: $${botParams.initialStake}\nTarget Profit: $${botParams.targetProfit}\nTicks to Analyze: ${botParams.analysisDigits}\n\nDo you want to start the Ghost AI Bot now?`);
        
        if (autoStart && typeof startGhostAiBot === 'function') {
            addLoadBotLog(`🚀 Auto-starting Ghost AI Bot...`, 'info');
            await startGhostAiBot();
        }
        
    } catch (error) {
        addLoadBotLog(`❌ Failed to apply configuration: ${error.message}`, 'error');
        showToast(`Failed to apply configuration: ${error.message}`, 'error');
    }
}

/**
 * Map XML configuration to Ghost AI bot parameters
 */
function mapXMLToBotParams(config) {
    const params = config.tradingParams;
    
    // Default values
    const botParams = {
        initialStake: 1.0,
        targetProfit: 50.0,
        payoutPercentage: 96,
        stopLoss: 20.0,
        maxMartingaleSteps: 5,
        analysisDigits: 20,
        s1CheckDigits: 2,
        s1MaxDigit: 2,
        s1Prediction: 2,
        s1Percentage: 65,
        s1MaxLosses: 3,
        s2CheckDigits: 5,
        s2MaxDigit: 4,
        s2Prediction: 5,
        s2ContractType: 'UNDER',
        s2Percentage: 45
    };
    
    // Try to extract values from XML parameters
    // Look for numeric values in the parameters
    for (const [key, value] of Object.entries(params)) {
        const lowerKey = key.toLowerCase();
        
        if (lowerKey.includes('initial stake') || lowerKey.includes('amount')) {
            const numValue = parseFloat(value);
            if (!isNaN(numValue)) botParams.initialStake = numValue;
        }
        
        if (lowerKey.includes('target profit') || lowerKey.includes('profit')) {
            const numValue = parseFloat(value);
            if (!isNaN(numValue)) botParams.targetProfit = numValue;
        }
        
        if (lowerKey.includes('stop') || lowerKey.includes('martingale stop')) {
            const numValue = parseFloat(value);
            if (!isNaN(numValue)) botParams.stopLoss = numValue;
        }
        
        if (lowerKey.includes('ticks to anal')) {
            const numValue = parseFloat(value);
            if (!isNaN(numValue)) botParams.analysisDigits = numValue;
        }
        
        if (lowerKey.includes('mart') && lowerKey.includes('split')) {
            const numValue = parseFloat(value);
            if (!isNaN(numValue)) botParams.maxMartingaleSteps = numValue;
        }
        
        if (lowerKey.includes('% win') || lowerKey.includes('payout')) {
            const numValue = parseFloat(value);
            if (!isNaN(numValue)) botParams.payoutPercentage = numValue;
        }
    }
    
    return botParams;
}

/**
 * Update Ghost AI bot input fields
 */
function updateGhostAIInputs(params) {
    const inputs = {
        'botInitialStake': params.initialStake,
        'botTargetProfit': params.targetProfit,
        'botPayoutPercentage': params.payoutPercentage,
        'botStopLoss': params.stopLoss,
        'botMaxMartingale': params.maxMartingaleSteps,
        'botAnalysisDigits': params.analysisDigits,
        'botS1CheckDigits': params.s1CheckDigits,
        'botS1MaxDigit': params.s1MaxDigit,
        'botS1Prediction': params.s1Prediction,
        'botS1Percentage': params.s1Percentage,
        'botS1MaxLosses': params.s1MaxLosses,
        'botS2CheckDigits': params.s2CheckDigits,
        'botS2MaxDigit': params.s2MaxDigit,
        'botS2Prediction': params.s2Prediction,
        'botS2ContractType': params.s2ContractType,
        'botS2Percentage': params.s2Percentage
    };
    
    for (const [id, value] of Object.entries(inputs)) {
        const element = document.getElementById(id);
        if (element) {
            element.value = value;
            // Trigger change event to update any listeners
            element.dispatchEvent(new Event('change'));
        }
    }
}

/**
 * Load and apply XML configuration
 */
async function loadAndApplyXMLConfig(filePath) {
    try {
        const config = await loadXMLConfig(filePath);
        await applyConfigToBot(config);
    } catch (error) {
        // Error already logged in loadXMLConfig
    }
}

/**
 * Start Load Bot - load all XML configs
 */
async function startLoadBot() {
    if (loadBotState.isLoading) return;

    loadBotState.isLoading = true;
    loadBotState.runId = `load-${Date.now()}`;

    addLoadBotLog(`🚀 Load Bot Started`, 'info');
    addLoadBotLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'info');

    // Load available XML files
    const xmlFiles = [
        'BOT/Rammy Auto 1,2,3 & % Over 2 &4.xml',
        'BOT/RAMMY-EVEN-ODD-CODE 111222.xml'
    ];

    let loadedCount = 0;
    for (const filePath of xmlFiles) {
        try {
            const config = await loadXMLConfig(filePath);
            loadedCount++;

            // Apply the first loaded config as current
            if (loadedCount === 1) {
                await applyConfigToBot(config);
            }

        } catch (error) {
            // Continue with next file
            continue;
        }
    }

    addLoadBotLog(`📊 Loaded ${loadedCount}/${xmlFiles.length} configurations`, loadedCount > 0 ? 'success' : 'warning');
    loadBotState.isLoading = false;
}

/**
 * Update load bot statistics
 */
function updateLoadBotStats() {
    const configCountEl = document.getElementById('loadBotConfigCount');
    const statusEl = document.getElementById('loadBotStatus');
    const lastLoadEl = document.getElementById('loadBotLastLoad');
    
    if (configCountEl) {
        configCountEl.textContent = loadBotState.configCount;
    }
    
    if (statusEl) {
        statusEl.textContent = loadBotState.isLoading ? 'Loading...' : 'Ready';
        statusEl.className = 'stat-value' + (loadBotState.isLoading ? '' : ' price-up');
    }
    
    if (lastLoadEl) {
        lastLoadEl.textContent = new Date().toLocaleTimeString();
    }
}

/**
 * Clear load bot history
 */
function clearLoadBotHistory() {
    if (confirm('Are you sure you want to clear all loaded configurations?')) {
        if (loadBotConfigTableBody) {
            loadBotConfigTableBody.innerHTML = '';
        }
        loadBotState.loadedConfigs = {};
        loadBotState.configCount = 0;
        loadBotState.currentConfig = null;
        
        updateLoadBotStats();
        addLoadBotLog('📋 Configuration history cleared', 'info');
        showToast('Configuration history cleared', 'success');
    }
}

/**
 * Get loaded configurations
 */
function getLoadedConfigs() {
    return loadBotState.loadedConfigs;
}

/**
 * Get current configuration
 */
function getCurrentConfig() {
    return loadBotState.currentConfig;
}