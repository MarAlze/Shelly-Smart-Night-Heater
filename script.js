/**
 * Shelly Script for intelligent control of a night storage heater.
 * Version: 4.2
 * ## Features:
 * 1. Backward Scheduling: The charge is scheduled to FINISH at a set time.
 * 2. Fetches the next day's weather forecast to calculate the required charge duration.
 * 3. Supports multiple switches (e.g., for Shelly Pro 1 and Shelly Pro 2).
 * 4. Uses a seasonal fallback duration if the weather API is unreachable.
 * 5. Includes a robust test mode with detailed console output and Telegram notifications.
 */

// ------------------- CONFIGURATION -------------------
// Adjust the following values to your needs.
let CONFIG = {
  // --- General Settings ---
  SWITCH_IDS: [0], // For Shelly Pro 1: [0] | For Shelly Pro 2: [0], [1], or [0, 1]

  // --- Charging Window ---
  CHARGING_WINDOW_START: "22:00", // Earliest possible start time (night tariff begins).
  CHARGING_WINDOW_END: "06:00",   // The time the charge should be completed.

  // --- Location for Weather API ---
  LATITUDE: 52.2768,
  LONGITUDE: 7.7190,

  // --- Heating Curve Parameters ---
  START_TEMP: 15.0,
  SLOPE: 0.5,
  MAX_RUNTIME_HOURS: 8.0,

  // --- Fallback & Telegram ---
  FALLBACK_HOURS_Q1: 6.0, FALLBACK_HOURS_Q2: 2.0,
  FALLBACK_HOURS_Q3: 0.0, FALLBACK_HOURS_Q4: 5.0,
  TELEGRAM_BOT_TOKEN: "",
  TELEGRAM_CHAT_ID: "",
  
  // --- Test Mode ---
  IS_TEST_MODE: true,
  TEST_INTERVAL_MINUTES: 5,

  // --- System Settings ---
  TIMEZONE: "Europe/Berlin",
  DATA_FETCH_TIME: "19:00"
};
// ---------------- END OF CONFIGURATION ----------------

// --- HELPER FUNCTIONS ---
function urlEncode(str) {
  var s = String(str);
  // Encode the percent sign first to avoid double-encoding other characters.
  s = s.split('%').join('%25');
  s = s.split(' ').join('%20');
  s = s.split('&').join('%26');
  s = s.split('+').join('%2B');
  s = s.split('?').join('%3F');
  s = s.split('=').join('%3D');
  s = s.split('#').join('%23');
  s = s.split('/').join('%2F');
  s = s.split(':').join('%3A');
  s = s.split(';').join('%3B');
  s = s.split('<').join('%3C');
  s = s.split('>').join('%3E');
  s = s.split('"').join('%22');
  s = s.split("'").join('%27');
  // The original function also encoded these, keeping for consistency.
  s = s.split('.').join('%2E');
  s = s.split(',').join('%2C');
  return s;
}

function timeToSeconds(timeStr) {
  let parts = timeStr.split(':');
  return (parseInt(parts[0]) * 3600) + (parseInt(parts[1]) * 60);
}

function secondsToTime(seconds) {
  let h = Math.floor(seconds / 3600);
  let m = Math.floor((seconds % 3600) / 60);
  return (h < 10 ? '0' : '') + String(h) + ":" + (m < 10 ? '0' : '') + String(m);
}

// --- CORE SCRIPT ---
let nextChargingDurationSeconds = -1;

function sendTelegramNotification(message) {
  if (!CONFIG.TELEGRAM_BOT_TOKEN || !CONFIG.TELEGRAM_CHAT_ID) { return; }
  let url = "https://api.telegram.org/bot" + CONFIG.TELEGRAM_BOT_TOKEN + "/sendMessage?chat_id=" + CONFIG.TELEGRAM_CHAT_ID + "&text=" + urlEncode("Shelly Heater: " + message);
  Shelly.call("HTTP.GET", { url: url, timeout: 10 }, function(res, err_code) {
    if (err_code === 0 && res.code === 200) console.log("INFO: Telegram notification sent.");
    else console.log("ERROR: Failed to send Telegram notification.");
  });
}

function getWeatherAndCalculateDuration() {
  console.log("INFO: Fetching weather data...");
  Shelly.call("HTTP.GET", { url: "https://api.open-meteo.com/v1/forecast?latitude=" + CONFIG.LATITUDE + "&longitude=" + CONFIG.LONGITUDE + "&hourly=temperature_2m&timezone=" + CONFIG.TIMEZONE + "&forecast_days=2", timeout: 15 }, function(res, err_code) {
    if (err_code !== 0 || !res || res.code !== 200) {
      let msg = "Weather API unreachable.";
      console.log("ERROR:", msg); sendTelegramNotification(msg); calculateFallbackDuration(); return;
    }
    console.log("INFO: Weather data received.");
    try {
      let data = JSON.parse(res.body);
      let temps = data.hourly.temperature_2m.slice(24, 48);
      if (temps.length < 24) { throw new Error("Incomplete data"); }
      let sum = 0; for (let i = 0; i < temps.length; i++) sum += temps[i];
      calculateChargingDuration(sum / temps.length);
    } catch (e) {
      let msg = "Failed to parse weather data.";
      console.log("ERROR:", msg); sendTelegramNotification(msg); calculateFallbackDuration();
    }
  });
}

function calculateChargingDuration(avgTemp) {
  console.log("INFO: Tomorrow's average temperature:", avgTemp.toFixed(2), "°C");
  let hours = (avgTemp < CONFIG.START_TEMP) ? (CONFIG.START_TEMP - avgTemp) * CONFIG.SLOPE : 0;
  if (hours > CONFIG.MAX_RUNTIME_HOURS) hours = CONFIG.MAX_RUNTIME_HOURS;
  if (hours < 0) hours = 0;
  nextChargingDurationSeconds = Math.round(hours * 3600);
  console.log("RESULT: Calculated duration:", hours.toFixed(2), "hours (", nextChargingDurationSeconds, "s)");
  scheduleCharging();
}

function calculateFallbackDuration() {
  Shelly.call("Sys.GetStatus", {}, function(res) {
    let month = res ? new Date(res.unixtime * 1000).getMonth() + 1 : 1;
    let hours = 0;
    if (month <= 3) hours = CONFIG.FALLBACK_HOURS_Q1; else if (month <= 6) hours = CONFIG.FALLBACK_HOURS_Q2;
    else if (month <= 9) hours = CONFIG.FALLBACK_HOURS_Q3; else hours = CONFIG.FALLBACK_HOURS_Q4;
    nextChargingDurationSeconds = Math.round(hours * 3600);
    console.log("FALLBACK: Using fallback for month", month, "-> Duration:", hours.toFixed(2), "hours");
    scheduleCharging();
  });
}

/**
 * Creates or updates the Shelly Schedules.
 * In test mode, it prints the intended schedule to the console instead.
 */
function scheduleCharging() {
  let windowEndSeconds = timeToSeconds(CONFIG.CHARGING_WINDOW_END);
  let windowStartSeconds = timeToSeconds(CONFIG.CHARGING_WINDOW_START);


  // Calculate the total available time in the window
  let windowDurationSeconds;
  if (windowStartSeconds > windowEndSeconds) { // Handles overnight windows like 22:00-06:00
      windowDurationSeconds = (24 * 3600 - windowStartSeconds) + windowEndSeconds;
  } else {
      windowDurationSeconds = windowEndSeconds - windowStartSeconds;
  }

  // Ensure the required charging time does not exceed the available window
  if (nextChargingDurationSeconds > windowDurationSeconds) {
    console.log("INFO: Calculated duration exceeds window. Capping duration to fit window.");
    nextChargingDurationSeconds = windowDurationSeconds;
  }
  
  // Calculate the dynamic start time using modulo arithmetic for robustness
  let dynamicStartSeconds = (windowEndSeconds - nextChargingDurationSeconds + 24 * 3600) % (24 * 3600);

  // Sanity check: If the calculated start time is outside the window, clamp it to the window start.
  // This makes the logic more robust against edge cases.
  let isOvernight = windowStartSeconds > windowEndSeconds;
  let startIsInWindow = (isOvernight)
      ? (dynamicStartSeconds >= windowStartSeconds || dynamicStartSeconds < windowEndSeconds)
      : (dynamicStartSeconds >= windowStartSeconds && dynamicStartSeconds < windowEndSeconds);

  if (!startIsInWindow && windowDurationSeconds > 0) {
      console.log("WARN: Calculated start time " + secondsToTime(dynamicStartSeconds) + " is outside window. Clamping to window start.");
      dynamicStartSeconds = windowStartSeconds;
      nextChargingDurationSeconds = windowDurationSeconds;
  }

  let dynamicStartTimeStr = secondsToTime(dynamicStartSeconds);

  // --- Test Mode Output ---
  if (CONFIG.IS_TEST_MODE) {
    if (nextChargingDurationSeconds > 0) {
      console.log("TEST MODE: Would schedule charging to start at " + dynamicStartTimeStr + " for " + Math.round(nextChargingDurationSeconds) + " seconds.");
    } else {
      console.log("TEST MODE: No charging would be scheduled.");
    }
    return;
  }
  
  // --- Production Mode Logic ---
  let cronExpr = "0 " + dynamicStartTimeStr.split(':')[1] + " " + dynamicStartTimeStr.split(':')[0] + " * * *";
  CONFIG.SWITCH_IDS.forEach(function(id) {
    Shelly.call("Schedule.DeleteAll", { id: id });
    if (nextChargingDurationSeconds > 0) {
      Shelly.call("Schedule.Create", {
        id: id, enable: true, timespec: cronExpr,
        calls: [{ method: "Switch.Set", params: { id: id, on: true, toggle_after: Math.round(nextChargingDurationSeconds) } }],
      }, function(res, err_code) {
        if (err_code === 0) console.log("SUCCESS: Switch", id, "scheduled to start at", dynamicStartTimeStr);
        else sendTelegramNotification("Failed to create schedule for Switch " + id);
      });
    } else {
      console.log("INFO: No charging required for Switch", id);
    }
  });
}

function initializeTimers() {
  if (CONFIG.IS_TEST_MODE) {
    console.log("INFO: Script starting in TEST MODE. Checks will run every", CONFIG.TEST_INTERVAL_MINUTES, "minutes.");
    sendTelegramNotification("Test mode activated. Notifications are working.");
    Timer.set(CONFIG.TEST_INTERVAL_MINUTES * 60 * 1000, true, getWeatherAndCalculateDuration);
  } else {
    let cronExpr = "0 " + CONFIG.DATA_FETCH_TIME.split(':')[1] + " " + CONFIG.DATA_FETCH_TIME.split(':')[0] + " * * *";
    console.log("INFO: Script starting in PRODUCTION MODE. Daily check scheduled with cron:", cronExpr);
    Shelly.call("Schedule.Create", { enable: true, timespec: cronExpr, calls: [{ method: "Script.Start", params: { id: Shelly.getCurrentScriptId() } }] });
  }
  getWeatherAndCalculateDuration();
}

// --- Script Entry Point ---
initializeTimers();
