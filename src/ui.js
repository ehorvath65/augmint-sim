'use strict';

const simulation = require('./lib/simulation.js');
const logger = require('./lib/logger.js');
const rates = require('./augmint/rates.js');
const graphs = require('./lib/graphs.js');
const scenario = require('./scenarios/base.js');
const AugmintError = require('./augmint/augmint.error.js');

// DOM elements
const clockElem = document.querySelector('.clock');
const pauseBtn = document.querySelector('.pause-btn');
const dumpStateBtn = document.querySelector('.dumpState-btn');
const dumpIterationLogBtn = document.querySelector('.dumpIterationLog-btn');
const dumpMovesLogBtn = document.querySelector('.dumpMovesLog-btn');
const toggleLogBtn = document.querySelector('.toggleLog-btn');
const logWrapper = document.querySelector('.log-wrapper');
const logTextArea = document.querySelector('.log-textarea');
const ratesDropDown = document.querySelector('.rates-dropdown');
const inputs = Array.from(document.querySelectorAll('.sim-inputs input'));
const graphsWrapper = document.querySelector('.graphs-wrapper');
const errorMsg = document.querySelector('.error-msg');

let lastRender = -1;
let paused = true;
let logVisible = false;
let benchmarkStart;
let benchmarkItCt;

function getParamsFromUI() {
    const params = {};

    inputs.forEach(input => {
        const value = Number.parseFloat(input.value) || 0;
        const key = input.dataset.key;

        if (!key) {
            return;
        }

        params[key] = value;
    });

    params.loanProduct = {
        minimumLoanInAcd: Number.parseFloat(document.getElementById('minimumLoanInAcd').value),
        loanCollateralRatio: Number.parseFloat(document.getElementById('loanCollateralRatio').value),
        interestPt: Number.parseFloat(document.getElementById('loanInterestPt').value), // p.a.
        repaymentPeriodInDays: Number.parseFloat(document.getElementById('repaymentPeriodInDays').value),
        defaultFeePercentage: Number.parseFloat(document.getElementById('defaultFeePercentage').value)
    };
    return params;
}

function updateUIFromParams() {
    const augmint = simulation.getState().augmint;
    inputs.forEach(input => {
        const key = input.dataset.key;
        input.value = augmint.params[key];
    });
    // we assume there is only 1 loanProduct but it's fine for now
    document.getElementById('minimumLoanInAcd').value = augmint.loanProducts[0].minimumLoanInAcd;
    document.getElementById('loanCollateralRatio').value = augmint.loanProducts[0].loanCollateralRatio;
    document.getElementById('loanInterestPt').value = augmint.loanProducts[0].interestPt;
    document.getElementById('repaymentPeriodInDays').value = augmint.loanProducts[0].repaymentPeriodInDays;
    document.getElementById('defaultFeePercentage').value = augmint.loanProducts[0].defaultFeePercentage;
}

function togglePause() {
    paused = !paused;

    if (paused) {
        // pausing sim:
        let runTime = Date.now() - benchmarkStart;
        pauseBtn.innerHTML = 'Continue';
        updateUIFromParams();
        inputs.forEach(input => {
            input.disabled = false;
        });

        console.debug(
            'Benchmark: iterations/sec: ',
            benchmarkItCt / (runTime / 1000),
            'iteration count:' + benchmarkItCt + ' running time: ' + runTime + 'ms'
        );
    } else {
        // restarting sim:
        benchmarkStart = Date.now();
        benchmarkItCt = 0;
        pauseBtn.innerHTML = 'Pause';
        inputs.forEach(input => {
            input.disabled = true;
        });
        simulation.patchAugmintParams(getParamsFromUI());
    }
}

function toggleLog() {
    logVisible = !logVisible;

    if (logVisible) {
        logWrapper.style.display = 'block';
        toggleLogBtn.innerHTML = 'Hide log';
    } else {
        logWrapper.style.display = 'none';
        toggleLogBtn.innerHTML = 'Show log';
    }
}

function ratesDropDownOnChange(newDay) {
    rates.setDay(newDay);
}

function populateRatesDropDown() {
    return new Promise(resolve => {
        for (let i = 0; i < rates.rates.length; i += 7) {
            let el = document.createElement('option');
            el.textContent = rates.rates[i].date + ' | ' + Math.round(rates.rates[i].close * 10000) / 10000;
            el.value = i;
            ratesDropDown.appendChild(el);
        }
        resolve();
    });
}

function init() {
    graphs.init(graphsWrapper);
    logger.init(simulation.getState, logTextArea);

    populateRatesDropDown();

    pauseBtn.addEventListener('click', togglePause);
    ratesDropDown.addEventListener('change', () => ratesDropDownOnChange(ratesDropDown.value));
    dumpStateBtn.addEventListener('click', () => {
        simulation.patchAugmintParams(getParamsFromUI());
        logger.print(simulation.getState());
    });
    dumpIterationLogBtn.addEventListener('click', () => {
        logger.printIterationLog();
    });
    dumpMovesLogBtn.addEventListener('click', () => {
        let startPos = logTextArea.textLength;
        logger.printMovesLog();
        logTextArea.focus();
        let endPos = logTextArea.textLength;
        startPos += logTextArea.value.substring(startPos, endPos).indexOf('\n') + 1;
        endPos = startPos + logTextArea.value.substring(startPos, endPos - 2).lastIndexOf('\n');
        logTextArea.selectionStart = startPos;
        logTextArea.selectionEnd = endPos;
        document.execCommand('copy');
        alert('Moves log CSV copied to clipboard');
    });
    toggleLogBtn.addEventListener('click', toggleLog);

    simulation.init({
        simulationParams: {
            randomSeed: 'change this for different repeatable results. or do not pass for a random seed',
            timeStep: 60 * 60 * 4 // 4 hours
        },
        // TODO: move all balances and params to UI
        augmintOptions: scenario.augmintOptions
    });
    updateUIFromParams();

    simulation.addActors(scenario.actors);
}

function render() {
    const state = simulation.getState();
    const daysPassed = state.meta.currentDay;

    // only re-render once per day:
    if (daysPassed > lastRender) {
        lastRender = daysPassed;
        clockElem.innerHTML = daysPassed;
        graphs.update(state.meta.currentTime, state.augmint);
    }
}

function mainLoop() {
    let doFrame = false;
    let start = Date.now();
    while (!paused && !doFrame) {
        benchmarkItCt++;
        try {
            simulation.incrementBy();
        } catch (err) {
            if (err instanceof AugmintError) {
                console.error(err);
                errorMsg.innerHTML = '<p>AugmintError: ' + err.message + '</p>';
                togglePause();
            } else {
                throw err;
            }
        }
        render();
        doFrame = Date.now() - start > 10;
    }
    requestAnimationFrame(mainLoop);
}

window.addEventListener('load', () => {
    init();
    mainLoop();
});
