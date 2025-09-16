/**
 * Shelly Script for intelligent control of a night storage heater.
 * Version: 5.0 (Fixed: daily timer for production mode re-added)
 *
 * ## Features:
 * 1.  Backward Scheduling: The charge is scheduled to FINISH at a set time.
 * 2.  Fetches the next day's weather forecast to calculate the required charge duration.
 * 3.  Supports multiple switches (e.g., for Shelly Pro 2).
 * 4.  Uses a seasonal fallback duration if the weather API is unreachable.
 * 5.  Includes a robust test mode with detailed console output and Telegram notifications.
 * 6.  Includes a reliable daily trigger for automatic schedule creation in production mode.
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
  
  SEND_TELEGRAM_SCHEDULE_LIST: false, // Send list of existing schedules?
  SEND_TELEGRAM_NEW_SCHEDULE: false,  // Send details of the new schedule?

  // --- Test Mode ---
  IS_TEST_MODE: false,
  TEST_INTERVAL_MINUTES: 5,

  // --- System Settings ---
  TIMEZONE: "Europe/Berlin",
  DATA_FETCH_TIME: "19:00"
};
// ---------------- END OF CONFIGURATION ----------------

// --- HELPER FUNCTIONS ---
function urlEncode(str) {
  var s = String(str);
  s = s.split(' ').join('%20');
  s = s.split(':').join('%3A');
  s = s.split('.').join('%2E');
  s = s.split(',').join('%2C');
  s = s.split('\n').join('%0A'); // Needed for multi-line messages
  return s;
}

function timeToSeconds(timeStr) {
  let parts = timeStr.split(':');
  return (parseInt(parts[0]) * 3600) + (parseInt(parts[1]) * 60);
}

function secondsToTime(seconds) {
  let h = Math.floor(seconds / 3600);
  let m = Math.floor((seconds % 3600) / 60);
  // This function is now only for display purposes (Telegram), so leading zeros are OK.
  return (h < 10 ? '0' : '') + String(h) + ":" + (m < 10 ? '0' : '') + String(m);
}

// --- CORE SCRIPT ---
let nextChargingDurationSeconds = -1;
let lastAvgTemp = -999;
// Status variable to prevent the calculation from running multiple times a day.
let hasRunToday = false;

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
  let weatherUrl = "https://api.open-meteo.com/v1/forecast?latitude=" + CONFIG.LATITUDE + "&longitude=" + CONFIG.LONGITUDE + "&hourly=temperature_2m&timezone=" + CONFIG.TIMEZONE + "&forecast_days=2";
  Shelly.call("HTTP.GET", { url: weatherUrl, timeout: 15 }, function(res, err_code) {
    if (err_code !== 0 || !res || res.code !== 200) {
      let msg = "Weather API unreachable. Code: " + String(err_code);
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
      let msg = "Failed to parse weather data. Error: " + e.message;
      console.log("ERROR:", msg); sendTelegramNotification(msg); calculateFallbackDuration();
    }
  });
}

function calculateChargingDuration(avgTemp) {
  lastAvgTemp = avgTemp;
  let hours = (avgTemp < CONFIG.START_TEMP) ? (CONFIG.START_TEMP - avgTemp) * CONFIG.SLOPE : 0;
  if (hours > CONFIG.MAX_RUNTIME_HOURS) hours = CONFIG.MAX_RUNTIME_HOURS;
  if (hours < 0) hours = 0;
  nextChargingDurationSeconds = Math.round(hours * 3600);
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

function scheduleCharging() {
  if (CONFIG.IS_TEST_MODE) {
    console.log("TEST MODE: No schedules will be created or deleted.");
    return;
  }

  console.log("INFO: Listing all existing schedules before deletion...");
  Shelly.call("Schedule.List", {}, function(list_res, list_err_code) {
    if (list_err_code !== 0) {
      let listErrorMsg = "ERROR: Failed to list schedules. Aborting.";
      console.log(listErrorMsg); sendTelegramNotification(listErrorMsg); return;
    }

    let scheduleListMsg = "Existing schedules before deletion:\n";
    if (list_res && list_res.jobs && list_res.jobs.length > 0) {
      for (let i = 0; i < list_res.jobs.length; i++) {
        let job = list_res.jobs[i];
        scheduleListMsg += "\nID: " + job.id + ", Aktiv: " + job.enable + ", Cron: " + job.timespec;
      }
    } else {
      scheduleListMsg += "No schedules found.";
    }
    console.log("DEBUG: " + scheduleListMsg.split('\n').join(' | '));
    if (CONFIG.SEND_TELEGRAM_SCHEDULE_LIST) {
      sendTelegramNotification(scheduleListMsg);
    }

    console.log("INFO: Deleting all existing schedules now...");
    Shelly.call("Schedule.DeleteAll", {}, function(res, err_code) {
      if (err_code !== 0) {
        let errorMsg = "ERROR: Failed to delete schedules. Aborting.";
        console.log(errorMsg); sendTelegramNotification(errorMsg); return;
      }

      console.log("SUCCESS: All old schedules deleted.");
      if (nextChargingDurationSeconds <= 0) {
        let message = "No charging required.\n\n" +
                      "Temperature forecast: " + lastAvgTemp.toFixed(2) + "°C\n" +
                      "switch-on threshold: " + CONFIG.START_TEMP.toFixed(2) + "°C";
        console.log("INFO: " + message.split('\n').join(' | '));
        if (CONFIG.SEND_TELEGRAM_NEW_SCHEDULE) {
          sendTelegramNotification(message);
        }
        return;
      }

      let windowEndSeconds = timeToSeconds(CONFIG.CHARGING_WINDOW_END);
      let dynamicStartSeconds = (windowEndSeconds - nextChargingDurationSeconds + 24 * 3600) % (24 * 3600);
      

      let h_cron = Math.floor(dynamicStartSeconds / 3600);
      let m_cron = Math.floor((dynamicStartSeconds % 3600) / 60);
      let cronExpr = "0 " + String(m_cron) + " " + String(h_cron) + " * * *";
      console.log("DEBUG: Generated cron expression for API: " + cronExpr);

      // We use the formatted time for display in Telegram.
      let dynamicStartTimeStr = secondsToTime(dynamicStartSeconds);
      let durationMinutes = (nextChargingDurationSeconds / 60).toFixed(2);
      let durationHours = (nextChargingDurationSeconds / 3600).toFixed(2);

      CONFIG.SWITCH_IDS.forEach(function(switchId) {
        let message = "New loading plan created.\n\n" +
                      "Temperature forecast: " + lastAvgTemp.toFixed(2) + "°C\n" +
                      "charging time: " + durationHours + " Std (" + durationMinutes + " Min)\n" +
                      "start time: " + dynamicStartTimeStr + "\n" +
                      "end time: " + CONFIG.CHARGING_WINDOW_END;
        
        let createParams = {
          enable: true, timespec: cronExpr,
          calls: [{ method: "Switch.Set", params: { id: switchId, on: true, toggle_after: nextChargingDurationSeconds } }],
        };

        Shelly.call("Schedule.Create", createParams, function(res_create, err_create) {
          if (err_create === 0) {
            console.log("SUCCESS: " + message.split('\n').join(' | '));
            if (CONFIG.SEND_TELEGRAM_NEW_SCHEDULE) {
              sendTelegramNotification(message);
            }
          } else {
            let errorMsg = "ERROR: Failed to create schedule for Switch " + switchId;
            console.log(errorMsg);
            sendTelegramNotification(errorMsg);
          }
        });
      });
    });
  });
}

// This function checks every minute whether it is time to start the calculation.
function dailyCheck() {
  Shelly.call("Sys.GetStatus", {}, function(result) {
    if (!result || !result.time) return; // Exit if no valid time
    console.log(result.time);
    // 
    let currentTime = result.time;

    // Check whether the target time has been reached AND the function has not yet run today.
    if (currentTime === CONFIG.DATA_FETCH_TIME && !hasRunToday) {
      console.log("INFO: Trigger time " + CONFIG.DATA_FETCH_TIME + " reached. Starting schedule creation.");
      sendTelegramNotification("Starte die Erstellung des Ladeplans für morgen.");
      getWeatherAndCalculateDuration();
      hasRunToday = true; // Remember that the function has been performed for today
    }

    // Reset of the “hasRunToday” flag shortly after midnight
    if (currentTime === "00:01") {
      if (hasRunToday) {
          console.log("INFO: Resetting daily run flag for the new day.");
          hasRunToday = false;
      }
    }
  });
}


function initializeTimers() {
  if (CONFIG.IS_TEST_MODE) {
    console.log("INFO: Script starting in TEST MODE. Checks will run every", CONFIG.TEST_INTERVAL_MINUTES, "minutes.");
    sendTelegramNotification("Test-Modus aktiviert.");
    // Run once immediately
    getWeatherAndCalculateDuration();
    // Then set the repeating timer
    Timer.set(CONFIG.TEST_INTERVAL_MINUTES * 60 * 1000, true, getWeatherAndCalculateDuration);
  } else {
    // PRODUCTION MODE:
    console.log("INFO: Script starting in PRODUCTION MODE. Will check time every minute to trigger at " + CONFIG.DATA_FETCH_TIME);
    sendTelegramNotification("Heizungs-Skript gestartet. Tägliche Prüfung um " + CONFIG.DATA_FETCH_TIME + " ist aktiv.");
   
    // Start a repeating timer that checks the time every minute.
    Timer.set(60000, true, dailyCheck);
    
    // We also run the check once on startup. This is useful if you restart the script
    // after the trigger time has already passed for the day, ensuring a schedule
    // for the upcoming night is still created.
    dailyCheck();
  }
}

// --- Script Entry Point ---
initializeTimers();
}

// --- Script Entry Point ---
initializeTimers();
