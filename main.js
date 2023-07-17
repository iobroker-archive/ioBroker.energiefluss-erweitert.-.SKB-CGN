'use strict';

/*
 * Created with @iobroker/create-adapter v2.3.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');

// Load your modules here, e.g.:
// const fs = require("fs");

/* Variables for runtime */
let globalConfig = {};
let sourceObject = {};
let settingsObject = {};
let rawValues = {
	values: {},
	sourceValues: {}
};

let outputValues = {
	values: {},
	unit: {},
	animations: {},
	animationProperties: {},
	fillValues: {},
	borderValues: {},
	prepend: {},
	append: {},
	css: {}
};

let relativeTimeCheck = {};
let globalInterval;

/* Variables for Icon Proxy */
const http = require("http");
const https = require("https");
const url = require("url");
const BASEURL = "https://api.iconify.design/";
const error_icon = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="coral" d="M11 15h2v2h-2v-2m0-8h2v6h-2V7m1-5C6.47 2 2 6.5 2 12a10 10 0 0 0 10 10a10 10 0 0 0 10-10A10 10 0 0 0 12 2m0 18a8 8 0 0 1-8-8a8 8 0 0 1 8-8a8 8 0 0 1 8 8a8 8 0 0 1-8 8Z"/></svg>';
let iconCacheObject = {};
let enable_proxy = false;
let proxy_port = 10123;
let _this;

class EnergieflussErweitert extends utils.Adapter {

	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	constructor(options) {
		super({
			...options,
			name: 'energiefluss-erweitert',
		});
		this.on('ready', this.onReady.bind(this));
		this.on('stateChange', this.onStateChange.bind(this));
		// this.on('objectChange', this.onObjectChange.bind(this));
		// this.on('message', this.onMessage.bind(this));
		this.on('unload', this.onUnload.bind(this));
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	async onReady() {
		// Initialize your adapter here
		enable_proxy = this.config.enable_proxy;
		proxy_port = this.config.proxy_port || 10123;
		_this = this;

		// Needed States
		await this.setObjectNotExistsAsync('configuration', {
			type: 'state',
			common: {
				name: 'Parameters for HTML Output',
				type: 'json',
				role: 'state',
				read: true,
				write: false,
				def: '{}'
			},
			native: {},
		});

		await this.setObjectNotExistsAsync('data', {
			type: 'state',
			common: {
				name: 'Data for HTML Output',
				type: 'json',
				role: 'state',
				read: true,
				write: false,
			},
			native: {},
		});

		await this.setObjectNotExistsAsync('battery_remaining', {
			type: 'state',
			common: {
				name: 'Remaining Time of the battery',
				type: 'string',
				role: 'text',
				read: true,
				write: false,
			},
			native: {},
		});

		await this.setObjectNotExistsAsync('backup', {
			type: 'state',
			common: {
				name: 'Last 10 Versions of Backups',
				type: 'json',
				role: 'state',
				read: true,
				write: false,
			},
			native: {},
		});

		this.log.info("Adapter started. Loading config!");

		/* Start the Icon Proxy Server */
		if (enable_proxy && proxy_port > 0) {
			this.startServer();
		}

		this.getConfig();
	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 * @param {() => void} callback
	 */
	onUnload(callback) {
		try {
			// Here you must clear all timeouts or intervals that may still be active
			// clearTimeout(timeout1);
			// clearTimeout(timeout2);
			// ...
			// clearInterval(interval1);
			clearInterval(globalInterval);
			this.log.info('Cleared interval for relative values!');
			callback();
		} catch (e) {
			callback();
		}
	}

	// If you need to react to object changes, uncomment the following block and the corresponding line in the constructor.
	// You also need to subscribe to the objects with `this.subscribeObjects`, similar to `this.subscribeStates`.
	// /**
	//  * Is called if a subscribed object changes
	//  * @param {string} id
	//  * @param {ioBroker.Object | null | undefined} obj
	//  */
	// onObjectChange(id, obj) {
	// 	if (obj) {
	// 		// The object was changed
	// 		this.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
	// 	} else {
	// 		// The object was deleted
	// 		this.log.info(`object ${id} deleted`);
	// 	}
	// }

	/**
	 * Is called if a subscribed state changes
	 * @param {string} id
	 * @param {ioBroker.State | null | undefined} state
	 */
	onStateChange(id, state) {
		let clearValue;
		if (state) {
			// The state was changed
			let cssRules = new Array();
			if (id == this.namespace + '.configuration') {
				this.log.info('Configuration changed via Workspace! Reloading config!');
				this.getConfig();
			} else {
				if (typeof (state.val) === 'string') {
					clearValue = Number(state.val.replace(/[^\d.-]/g, ''));
				} else {
					clearValue = state.val;
				}

				// Loop through each Element, which belongs to that source
				if (sourceObject[id].hasOwnProperty('elmSources')) {
					// Put Value into RAW-Source-Values
					rawValues.sourceValues[sourceObject[id].id] = clearValue;
					this.log.debug(JSON.stringify(rawValues.sourceValues));

					for (var _key of Object.keys(sourceObject[id].elmSources)) {
						let src = sourceObject[id].elmSources[_key];

						// Put ID into CSS-Rule for later use
						cssRules.push(src);

						// VALUES
						if (settingsObject.hasOwnProperty(src)) {
							this.log.debug("Value-Settings for Element " + src + " found! Applying Settings!");
							// Convertible
							let seObj = settingsObject[src];
							if (seObj.type == 'text') {
								// Check, if we have source options for text - Date
								if (seObj.source_option != -1) {
									this.log.debug('Source Option detected! ' + seObj.source_option + 'Generating DateString for ' + state.ts + ' ' + this.getDateTime(state.ts, seObj.source_option));
									outputValues.values[src] = this.getDateTime(state.ts, seObj.source_option);
									rawValues.values[src] = 0;
								} else {
									// Threshold need to be positive
									if (seObj.threshold >= 0) {
										let formatValue;
										this.log.debug('Threshold for: ' + src + ' is: ' + seObj.threshold);
										// Check, if we have Subtractions for this value
										let subArray = seObj.subtract;
										if (subArray.length > 0) {
											let tmpVal = 0;
											for (var sub in subArray) {
												if (subArray[sub] != -1) {
													tmpVal = tmpVal + Math.abs(rawValues.sourceValues[subArray[sub]]);
													this.log.debug("Subtracted by: " + subArray.toString());
												}
											}
											formatValue = clearValue > 0 ? clearValue - (tmpVal) : clearValue + (tmpVal);
										} else {
											formatValue = clearValue;
										}
										// Check, if value is over threshold
										if (Math.abs(formatValue) >= seObj.threshold) {

											// Format Value
											outputValues.values[src] = this.valueOutput(src, formatValue);
										} else {
											outputValues.values[src] = seObj.decimal_places >= 0 ? this.decimalPlaces(0, seObj.decimal_places) : clearValue;
										}
									}
									rawValues.values[src] = clearValue;
								}
							} else {
								if (seObj.fill_type != -1 && seObj.fill_type) {
									outputValues.fillValues[src] = clearValue;
								}
								if (seObj.border_type != -1 && seObj.border_type) {
									outputValues.borderValues[src] = clearValue;
								}
							}
							if (seObj.source_display == 'text') {
								outputValues.values[src] = state.val;
								rawValues.values[src] = state.val;
							}
						} else {
							outputValues.values[src] = clearValue;
							rawValues.values[src] = clearValue;
						}
					}
				}

				// Check, if that Source belongs to battery-charge or discharge, to determine the time
				if (globalConfig.hasOwnProperty('calculation')) {
					if (sourceObject[id].id == globalConfig.calculation.battery.charge || sourceObject[id].id == globalConfig.calculation.battery.discharge) {
						if (globalConfig.calculation.battery.charge != -1 && globalConfig.calculation.battery.discharge != -1 && globalConfig.calculation.battery.percent != -1) {
							let direction = 'none';
							let energy = 0;
							let dod = globalConfig.calculation.battery.dod ? globalConfig.calculation.battery.dod : 0;

							if (globalConfig.calculation.battery.charge != globalConfig.calculation.battery.discharge) {
								if (sourceObject[id].id == globalConfig.calculation.battery.charge) {
									direction = 'charge';
									energy = globalConfig.calculation.battery.charge_kw ? Math.abs(clearValue * 1000) : Math.abs(clearValue);
								}
								if (sourceObject[id].id == globalConfig.calculation.battery.discharge) {
									direction = 'discharge';
									energy = globalConfig.calculation.battery.discharge_kw ? Math.abs(clearValue * 1000) : Math.abs(clearValue);
								}
							}

							if (globalConfig.calculation.battery.charge == globalConfig.calculation.battery.discharge) {
								if (clearValue > 0) {
									if (!globalConfig.calculation.battery.charge_prop) {
										direction = 'charge';
										energy = globalConfig.calculation.battery.charge_kw ? Math.abs(clearValue * 1000) : Math.abs(clearValue);
									}
									if (!globalConfig.calculation.battery.discharge_prop) {
										direction = 'discharge';
										energy = globalConfig.calculation.battery.discharge_kw ? Math.abs(clearValue * 1000) : Math.abs(clearValue);
									}
								}
								if (clearValue < 0) {
									if (globalConfig.calculation.battery.charge_prop) {
										direction = 'charge';
										energy = globalConfig.calculation.battery.charge_kw ? Math.abs(clearValue * 1000) : Math.abs(clearValue);
									}
									if (globalConfig.calculation.battery.discharge_prop) {
										direction = 'discharge';
										energy = globalConfig.calculation.battery.discharge_kw ? Math.abs(clearValue * 1000) : Math.abs(clearValue);
									}
								}
							}
							this.calculateBatteryRemaining(direction, energy, globalConfig.calculation.battery.capacity, dod);
						}
					}
				}

				// Animations
				if (sourceObject[id].hasOwnProperty('elmAnimations')) {
					this.log.debug('Found corresponding animations for ID: ' + id + '! Applying!');
					for (var _key of Object.keys(sourceObject[id].elmAnimations)) {
						let src = sourceObject[id].elmAnimations[_key];
						// Object Variables
						let tmpType, tmpStroke, tmpDuration, tmpOption;

						// Put ID into CSS-Rule for later use
						cssRules.push(src);

						let tmpAnimValid = true;
						// Animations
						if (settingsObject.hasOwnProperty(src)) {
							this.log.debug("Animation-Settings for Element " + src + " found! Applying Settings!");
							let seObj = settingsObject[src];

							if (seObj.type != -1 && seObj != undefined) {
								if (seObj.type == 'dots') {
									tmpType = 'dots';
									tmpStroke = this.calculateStrokeArray(seObj.dots, seObj.power, Math.abs(clearValue));
								}
								if (seObj.type == 'duration') {
									tmpType = 'duration';
									tmpDuration = this.calculateDuration(seObj.duration, seObj.power, Math.abs(clearValue));
								}
							}

							switch (seObj.properties) {
								case 'positive':
									this.log.debug('Animation has a positive factor!');
									if (clearValue > 0) {
										if (clearValue >= seObj.threshold) {
											this.log.debug('Value: ' + clearValue + ' is greater than Threshold: ' + seObj.threshold + ' Applying Animation!');
											tmpAnimValid = true;
											tmpOption = '';
										} else {
											this.log.debug('Value: ' + clearValue + ' is smaller than Threshold: ' + seObj.threshold + ' Deactivating Animation!');
											tmpAnimValid = false;
										}
									} else {
										if (seObj.option) {
											if (clearValue <= seObj.threshold * -1) {
												tmpAnimValid = true;
												// Set Option
												tmpOption = 'reverse';
											} else {
												tmpAnimValid = false;
											}
										} else {
											tmpAnimValid = false;
										}
									}
									break;
								case 'negative':
									this.log.debug('Animation has a negative factor!');
									if (clearValue < 0) {
										if (clearValue <= seObj.threshold * -1) {
											this.log.debug('Value: ' + clearValue + ' is greater than Threshold: ' + seObj.threshold * -1 + ' Applying Animation!');
											tmpAnimValid = true;
											tmpOption = '';
										} else {
											this.log.debug('Value: ' + clearValue + ' is smaller than Threshold: ' + seObj.threshold * -1 + ' Deactivating Animation!');
											tmpAnimValid = false;
										}
									} else {
										if (seObj.option) {
											if (clearValue >= seObj.threshold) {
												tmpAnimValid = true;
												// Set Option
												tmpOption = 'reverse';
											} else {
												tmpAnimValid = false;
											}
										} else {
											tmpAnimValid = false;
										}
									}
									break;
							}


							// Set Animation
							outputValues.animations[src] = tmpAnimValid;

							// Create Animation Object
							outputValues.animationProperties[src] = {
								type: tmpType,
								duration: tmpDuration,
								stroke: tmpStroke,
								option: tmpOption
							};
						}
					}
				}

				// Put CSS together
				if (cssRules.length > 0) {
					cssRules.forEach((src) => {
						let seObj = settingsObject[src];

						// CSS Rules
						if (seObj.threshold >= 0) {
							if (Math.abs(clearValue) > seObj.threshold) {
								// CSS Rules
								if (clearValue > 0) {
									// CSS Rules - Positive
									outputValues.css[src] = {
										actPos: seObj.css_active_positive,
										inactPos: seObj.css_inactive_positive,
										actNeg: "",
										inactNeg: seObj.css_active_negative
									};
								}
								if (clearValue < 0) {
									// CSS Rules - Negative
									outputValues.css[src] = {
										actNeg: seObj.css_active_negative,
										inactNeg: seObj.css_inactive_negative,
										actPos: "",
										inactPos: seObj.css_active_positive
									};
								}
							} else {
								// CSS Rules
								if (clearValue > 0) {
									// CSS Rules - Positive
									outputValues.css[src] = {
										actPos: seObj.css_inactive_positive,
										inactPos: seObj.css_active_positive,
										actNeg: "",
										inactNeg: seObj.css_active_negative
									};
								}
								if (clearValue < 0) {
									// CSS Rules - Negative
									outputValues.css[src] = {
										actNeg: seObj.css_inactive_negative,
										inactNeg: seObj.css_active_negative,
										actPos: "",
										inactPos: seObj.css_active_positive
									};
								}
								if (clearValue == 0) {
									// CSS Rules - Positive
									outputValues.css[src] = {
										actPos: "",
										inactPos: seObj.css_active_positive + ' ' + seObj.css_inactive_positive,
										actNeg: "",
										inactNeg: seObj.css_active_negative + ' ' + seObj.css_inactive_negative
									};
								}
							}
						}
					});
				}

				this.log.debug('State changed! New value for Source: ' + id + ' with Value: ' + clearValue + ' belongs to Elements: ' + sourceObject[id].elmSources.toString());

				// Build Output
				this.buildData();
			}
		}
	}

	// If you need to accept messages in your adapter, uncomment the following block and the corresponding line in the constructor.
	// /**
	//  * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
	//  * Using this method requires "common.messagebox" property to be set to true in io-package.json
	//  * @param {ioBroker.Message} obj
	//  */
	// onMessage(obj) {
	// 	if (typeof obj === 'object' && obj.message) {
	// 		if (obj.command === 'send') {
	// 			// e.g. send email or pushover or whatever
	// 			this.log.info('send command');

	// 			// Send response in callback if required
	// 			if (obj.callback) this.sendTo(obj.from, obj.command, 'Message received', obj.callback);
	// 		}
	// 	}
	// }
	/**
	 *  @param {number}	minutes
	 */
	getMinHours(minutes) {
		let mins = minutes;
		let m = mins % 60;
		let h = (mins - m) / 60;
		let HHMM = (h < 10 ? "0" : "") + h.toString() + ":" + (m < 10 ? "0" : "") + m.toString();
		return HHMM;
	}

	/**
	 *  @param {string}	direction
	 *  @param {number}	energy
	 *  @param {number} battery_capacity
	 *  @param {number} battery_dod
	 */
	async calculateBatteryRemaining(direction, energy, battery_capacity, battery_dod) {
		const battPercent = await this.getForeignStateAsync(globalConfig.datasources[globalConfig.calculation.battery.percent].source);
		let percent = battPercent.val;
		let rest = 0;
		let mins = 0;
		let result = '';
		let string = '';
		if (percent > 0 && energy > 0) {
			if (direction == "charge") {
				// Get the Rest to Full Charge
				rest = battery_capacity - ((battery_capacity * percent) / 100);
			}

			if (direction == "discharge") {
				// Get the Rest to Full Discharge
				rest = (battery_capacity * (percent - battery_dod)) / 100;
			}

			mins = Math.round((rest / energy) * 60);
			if (mins > 0) {
				result = this.getMinHours(mins);
			} else {
				result = "--:--";
			}
			string += result + "h";
		} else {
			string += "--:--h";
		}
		this.log.debug("Direction: " + direction + " Battery-Time: " + string + " Percent: " + percent + " Energy: " + energy);

		await this.setStateAsync("battery_remaining", string, true);
	}

	/**
		 * @param {number} src
		 * @param {number} value
	*/
	valueOutput(src, value) {
		let seObj = settingsObject[src];
		// Convert to positive if necessary
		let cValue = seObj.convert ? this.convertToPositive(value) : value;
		// Convert to kW if set
		cValue = seObj.calculate_kw ? this.recalculateValue(cValue) : cValue;
		// Set decimal places
		cValue = seObj.decimal_places >= 0 ? this.decimalPlaces(cValue, seObj.decimal_places) : cValue;
		return cValue;
	}

	/**
		 * @param {number} duration
	*/
	msToTime(duration) {
		var seconds = Math.floor((duration / 1000) % 60),
			minutes = Math.floor((duration / (1000 * 60)) % 60),
			hours = Math.floor((duration / (1000 * 60 * 60)) % 24),
			value = 'just now';

		if (seconds > 0) {
			if (seconds < 5 && seconds > 2) {
				value = 'a few seconds ago';
			} else if (seconds == 1) {
				value = seconds + ' second ago';
			} else {
				value = seconds + ' seconds ago'
			}
		}

		if (minutes > 0) {
			if (minutes < 5 && minutes > 2) {
				value = 'a few minutes ago';
			} else if (minutes == 1) {
				value = minutes + ' minute ago';
			} else {
				value = minutes + ' minutes ago'
			}
		}

		if (hours > 0) {
			if (hours < 5 && hours > 2) {
				value = 'a few hours ago';
			} else if (hours == 1) {
				value = hours + ' hour ago';
			} else {
				value = hours + ' hours ago';
			}
		}
		return value;
	}
	/**
		 * @param {number} ts
		 * @param {string} mode
	*/

	getDateTime(ts, mode) {
		if (ts === undefined || ts <= 0 || ts == '') {
			return '';
		}
		let date = new Date(ts), now = new Date();

		switch (mode) {
			case 'timestamp_de':
			default:
				return date.toLocaleString('de-DE', {
					hour: "numeric",
					minute: "numeric",
					day: "2-digit",
					month: "2-digit",
					year: "numeric",
					second: "2-digit",
					hour12: false
				});
			case 'timestamp_de_short':
				return date.toLocaleString('de-DE', {
					hour: "2-digit",
					minute: "2-digit",
					day: "2-digit",
					month: "2-digit",
					year: "2-digit",
					hour12: false
				});
			case 'timestamp_de_short_wo_year':
				return date.toLocaleString('de-DE', {
					hour: "2-digit",
					minute: "2-digit",
					day: "2-digit",
					month: "2-digit",
					hour12: false
				});
			case 'timestamp_us':
				return date.toLocaleString('en-US', {
					hour: "numeric",
					minute: "numeric",
					day: "2-digit",
					month: "2-digit",
					year: "numeric",
					second: "2-digit",
					hour12: true
				});
			case 'timestamp_us_short':
				return date.toLocaleString('en-US', {
					hour: "2-digit",
					minute: "2-digit",
					day: "2-digit",
					month: "2-digit",
					year: "2-digit",
					hour12: true
				});
			case 'timestamp_us_short_wo_year':
				return date.toLocaleString('en-US', {
					hour: "2-digit",
					minute: "2-digit",
					day: "2-digit",
					month: "2-digit",
					hour12: true
				});
			case 'relative':
				return this.msToTime(Number(now - date));
		}
	}

	async getRelativeTimeObjects(obj) {
		for (var key of Object.keys(obj)) {
			const stateValue = await this.getForeignStateAsync(obj[key].source);
			if (stateValue) {
				outputValues.values[key] = this.getDateTime(stateValue.ts, obj[key].option);
			}
		}
	}

	/**
	 * @param {number} value
	 */
	recalculateValue(value) {
		return (Math.round((value / 1000) * 100) / 100);
	}

	/**
	 * @param {number} value
	 * @param {number} decimal_places
	 */
	decimalPlaces(value, decimal_places) {
		return (Number(value).toFixed(decimal_places));
	}

	/**
	 * @param {number} value
	 */
	convertToPositive(value) {
		return value < 0 ? (value * -1) : value;
	}

	/**
	 * @param {number} maxDuration
	 * @param {number} maxPower
	 * @param {number} currentPower
	 */

	calculateDuration(maxDuration, maxPower, currentPower) {
		// Max Duration
		let cur = Number(currentPower);
		let max = Number(maxPower);
		let dur = Number(maxDuration);
		let result = Math.round((max / cur) * dur);
		result = result > 60000 ? 60000 : result;

		return result;
	}

	/**
	 * @param {number} maxDots
	 * @param {number} maxPower
	 * @param {number} currentPower
	 */

	calculateStrokeArray(maxDots, maxPower, currentPower) {
		// First calculate, what we have
		let dots = Math.round((((currentPower / maxPower) * 100) * maxDots) / 100);
		// Collect all Values
		let strokeDash = '';
		let total = 136;
		let l_amount = dots;
		let l_distance = globalConfig.animation_configuration.distance;
		let l_length = globalConfig.animation_configuration.length;

		for (let i = 0; i < l_amount; i++) {
			if (l_distance > 0 && l_length > 0) {
				strokeDash += l_length + ' ';
				if (i != l_amount - 1) {
					strokeDash += l_distance + ' ';
					total -= l_distance;
				}
				total -= l_length;
			}
		}
		if (l_amount > 0 && l_length > 0 && l_distance) {
			strokeDash += ' ' + total;
		}

		return strokeDash;
	}


	async buildData() {
		await this.setStateAsync('data', JSON.stringify(outputValues), true);
	}

	async getConfig() {
		// Reset the Arrays/Objects
		globalConfig = {};
		outputValues = {
			values: {},
			unit: {},
			animations: {},
			fillValues: {},
			borderValues: {},
			animationProperties: {},
			prepend: {},
			append: {},
			css: {}
		};
		rawValues = {
			values: {},
			sourceValues: {}
		};
		sourceObject = {};
		settingsObject = {};
		let clearValue;
		let tmpArray = new Array();
		relativeTimeCheck = {};
		// Put own DP
		tmpArray.push(this.namespace + '.configuration');
		// Read configuration DataPoint
		let tmpConfig = await this.getStateAsync('configuration');
		try {
			globalConfig = JSON.parse(tmpConfig.val);
		}
		catch (e) {
			this.log.warn("This is the first time, the adapter starts. Setting config to default (empty)!");
			globalConfig = {};
		}
		this.log.debug(JSON.stringify(globalConfig));

		// Collect all Datasources
		if (globalConfig.hasOwnProperty('datasources')) {
			for (var key of Object.keys(globalConfig.datasources)) {
				const value = globalConfig.datasources[key];
				this.log.debug('Datasource: ' + JSON.stringify(value));
				if (value.source != '' && value.hasOwnProperty('source')) {
					const stateValue = await this.getForeignStateAsync(globalConfig.datasources[key].source);
					if (stateValue) {
						// Add, to find it better
						sourceObject[globalConfig.datasources[key].source] = {
							id: parseInt(key),
							elmSources: [],
							elmAnimations: [],
						};
						rawValues.sourceValues[key] = stateValue.val;
						// Add to SubscribeArray
						tmpArray.push(value.source);
					} else {
						this.log.warn("The adapter could not find the state '" + value.source + "'! Please review your configuration of the adapter!");
					}
				}
			}
		}

		// Collect the Elements, which are using the sources
		if (globalConfig.hasOwnProperty('elements')) {
			for (var key of Object.keys(globalConfig.elements)) {
				const value = globalConfig.elements[key];
				if (value.source != -1 && value.hasOwnProperty('source')) {
					this.log.debug("Source for Element: " + key + " is: " + value.source + " Plain: " + globalConfig.datasources[value.source].source);
					const stateValue = await this.getForeignStateAsync(globalConfig.datasources[value.source].source);
					if (stateValue) {
						// Insert into initialValues
						if (typeof (stateValue.val) === 'string') {
							clearValue = Number(stateValue.val.replace(/[^\d.-]/g, ''));
						} else {
							clearValue = stateValue.val;
						}

						// Save Settings for the states
						settingsObject[key] = {
							threshold: value.threshold || 0,
							calculate_kw: value.calculate_kw,
							decimal_places: value.decimal_places,
							convert: value.convert,
							type: value.type,
							source_option: value.source_option,
							source_display: value.source_display,
							subtract: value.subtract,
							css_general: value.css_general,
							css_active_positive: value.css_active_positive,
							css_inactive_positive: value.css_inactive_positive,
							css_active_negative: value.css_active_negative,
							css_inactive_negative: value.css_inactive_negative,
							fill_type: value.fill_type,
							border_type: value.border_type
						};

						// Append and prepend
						outputValues.append[key] = value.append;
						outputValues.prepend[key] = value.prepend;

						// Output Values
						if (value.type == 'text') {
							// Check, if we have source options for text - Date
							if (value.source_option != -1) {
								outputValues.values[key] = this.getDateTime(stateValue.ts, value.source_option);
								outputValues.unit[key] = value.unit;
								rawValues.values[key] = 0;

								// Put into timer object for re-requesting
								if (value.source_option == 'relative') {
									relativeTimeCheck[key] = {
										source: globalConfig.datasources[value.source].source,
										option: value.source_option
									}
								}
							} else if (value.source_display == 'text') {
								outputValues.values[key] = stateValue.val;
								outputValues.unit[key] = value.unit;
								rawValues.values[key] = stateValue.val;
							}
							else {
								outputValues.values[key] = this.valueOutput(key, clearValue);
								outputValues.unit[key] = value.unit;
								rawValues.values[key] = clearValue;
							}
						} else {
							if (value.fill_type != -1 && value.fill_type) {
								outputValues.fillValues[key] = clearValue;
							}
							if (value.border_type != -1 && value.border_type) {
								outputValues.borderValues[key] = clearValue;
							}
						}

						// Put Elm into Source
						sourceObject[globalConfig.datasources[value.source].source].elmSources.push(key);
					}
				}
			}
		}

		// Animations
		if (globalConfig.hasOwnProperty('animations')) {
			for (var key of Object.keys(globalConfig.animations)) {
				const value = globalConfig.animations[key];
				if (value.source != -1 && value.hasOwnProperty('source')) {
					if (value.source.length !== 0) {
						this.log.debug("Animation for Source: " + value.source + " is: " + key);
						// Put Animation into Source
						sourceObject[globalConfig.datasources[value.source].source].elmAnimations.push(key);
						settingsObject[key] = {
							properties: value.animation_properties,
							option: value.animation_option,
							threshold: value.threshold,
							type: value.animation_type,
							duration: value.duration,
							power: value.power,
							dots: value.dots,
							css_general: value.css_general,
							css_active_positive: value.css_active_positive,
							css_inactive_positive: value.css_inactive_positive,
							css_active_negative: value.css_active_negative,
							css_inactive_negative: value.css_inactive_negative
						}
					} else {
						this.log.debug("Animation for Source: " + value.source + " not found!");
					}
				}
			}
		}

		this.log.debug('CSS: ' + JSON.stringify(outputValues.css));
		this.log.debug('Settings: ' + JSON.stringify(settingsObject));
		this.log.debug("Initial Values: " + JSON.stringify(outputValues.values));
		this.log.debug("Initial Fill-Values: " + JSON.stringify(outputValues.fillValues));
		this.log.debug('Sources: ' + JSON.stringify(sourceObject));
		this.log.debug('RAW-Values: ' + JSON.stringify(rawValues.values));
		this.log.debug('RAW-Source-Values: ' + JSON.stringify(rawValues.sourceValues));
		// Starting Timier
		if (Object.keys(relativeTimeCheck).length > 0) {
			this.log.info('Found relative Date Texts (' + Object.keys(relativeTimeCheck).length + ') to display. Activating timer!');
			this.log.debug('Array for relative texts ' + relativeTimeCheck);
			globalInterval = this.setInterval(() => {
				this.getRelativeTimeObjects(relativeTimeCheck);
			}, 10000);
		}
		this.buildData();

		this.log.info('Configuration loaded!');
		this.log.info("Requesting the following states: " + tmpArray.toString());

		// Renew the subscriptions
		this.subscribeForeignStates(tmpArray);
	}

	startServer() {
		function requestListener(req, res) {
			try {
				let query = url.parse(req.url, true).query;
				let callback = query.callback;
				let message;
				res.setHeader("Content-Type", "text");
				// Query for icon
				switch (query.serve) {
					case "icon":
						if (query.icon) {
							// Check, if icon is available in Cache
							if (iconCacheObject.hasOwnProperty(query.icon)) {
								iconCacheObject[query.icon].status = 'served via Cache';
								res.writeHead(200);
								res.end(callback + '(' + JSON.stringify(iconCacheObject[query.icon]) + ")");
								_this.log.debug(`Icon ${query.icon} served via: ${iconCacheObject[query.icon].status}`);
							} else {
								let icon = query.icon.split(":");
								let url = BASEURL + `${icon[0]}/${icon[1]}.svg?width=${query.width}&height=${query.height}`;
								https.get(url, result => {
									let data = [];
									result.on('data', chunk => {
										data.push(chunk);
									});

									result.on('end', () => {
										if (result.statusCode >= 200 && result.statusCode <= 299) {
											message = Buffer.concat(data).toString();
											if (message != 404) {
												// Put Icon into cache
												iconCacheObject[query.icon] = {
													icon: message,
													status: 'served via Server'
												}
												res.writeHead(200);
												res.end(callback + '(' + JSON.stringify(iconCacheObject[query.icon]) + ")");
											} else {
												// Put Icon into cache
												iconCacheObject[query.icon] = {
													icon: error_icon,
													message: "Icon not found!",
													status: 'served via Server'
												}
												res.writeHead(200);
												res.end(callback + '(' + JSON.stringify(iconCacheObject[query.icon]) + ")");
											}
											_this.log.debug(`Icon ${query.icon} served via: ${iconCacheObject[query.icon].status}`);
										} else {
											// Server down or not found
											res.writeHead(200);
											res.end(callback + '(' + JSON.stringify(error_icon) + ")");
										}
									});
								}).on('error', err => {
									this.log.error('Icon-Proxy-Error: ', err.message);
								});
							}
						} else {
							res.writeHead(404);
							res.end("No Icon specified");
						}
						break;
					default:
						res.writeHead(404);
						res.end("Request could not be handled! Please make sure, to request the icon via: ?serve=icon&icon=NameOfIcon");
				}
			}
			catch (error) {
				adapter.log.error("Something went wrong during processing Data inside Icon-Proxy! " + error);
			}
		}

		const server = http.createServer(requestListener);
		server.listen(proxy_port, () => {
			this.log.info(`Icon Proxy-Server is running on Port: ${proxy_port}`);
		});
	}

}

if (require.main !== module) {
	// Export the constructor in compact mode
	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	module.exports = (options) => new EnergieflussErweitert(options);
} else {
	// otherwise start the instance directly
	new EnergieflussErweitert();
}