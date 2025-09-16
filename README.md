# Shelly-Smart-Night-Heater

A smart Shelly script for weather-aware, efficient control of electric heaters, specifically designed for night storage heaters.

This project was born out of necessity. Around Christmas, my mother's central charging controller for her night storage heating system failed. Faced with an expensive replacement for an aging system, I developed this script as a modern, flexible, and cost-effective solution using a simple Shelly device.

The script optimizes the charging process by analyzing the next day's weather forecast and scheduling the heater to complete its charge precisely when the cheaper night-tariff window ends. This saves energy, increases comfort, and gives old heating systems a new, smart life.

---

## 🚀 Features

* **Weather-Aware Control:** Calculates the optimal charging duration based on the next day's forecasted average temperature.
* **Efficient Backward Scheduling:** The charge is scheduled to *finish* at a set time (e.g., 6 AM), ensuring heat is available exactly when needed.
* **Configurable Heating Curve:** Easily customize the charging logic to your specific needs (`START_TEMP`, `SLOPE`).
* **Flexible Hardware Support:** Supports multiple switches, making it ideal for Shelly Pro 1, Pro 2, and others.
* **Robust Fallback System:** Uses a seasonal default duration if the weather API is unreachable.
* **Optional Monitoring:** Sends notifications for critical errors via Telegram.
* **Safe Test Mode:** Allows for safe logic testing without actually switching the relays.

---

## 🔧 Setup

1.  **Prerequisites:**
    * A Shelly device with scripting enabled (e.g., Shelly Pro 1, Pro 2, Plus 1).
    * The device must be connected to the internet and have the correct time (synced via NTP).

2.  **Installation:**
    * Open the web interface of your Shelly device.
    * Navigate to the **Scripts** menu.
    * Copy the content of the `script.js` file from this repository.
    * Paste the code into a new script on your Shelly.
    * Save and start the script.

---

## ⚙️ Configuration

All settings are managed directly within the `CONFIG` object at the top of the script.

```javascript
let CONFIG = {
  // --- General Settings ---
  SWITCH_IDS: [0], // IDs of the switch(es) to control. E.g., [0, 1] for a Shelly Pro 2

  // --- Charging Window ---
  CHARGING_WINDOW_START: "22:00", // Start of the night tariff
  CHARGING_WINDOW_END: "06:00",   // The time the charge should be completed

  // --- Location for Weather API ---
  LATITUDE: 52.2659,  // Your geographical latitude
  LONGITUDE: 7.7211, // Your geographical longitude

  // --- Heating Curve Parameters ---
  START_TEMP: 15.0, // Temperature at which heating starts
  SLOPE: 0.5,       // Additional charge time per degree colder (in hours/°C)
  MAX_RUNTIME_HOURS: 8.0, // Absolute maximum charge duration

  // --- Fallback & Telegram ---
  FALLBACK_HOURS_Q1: 6.0, FALLBACK_HOURS_Q2: 2.0,
  FALLBACK_HOURS_Q3: 0.0, FALLBACK_HOURS_Q4: 5.0,

  // --- Telegram Notifications (Optional) ---
  TELEGRAM_BOT_TOKEN: "", // Your bot token
  TELEGRAM_CHAT_ID: "",   // Your chat ID

  SEND_TELEGRAM_SCHEDULE_LIST: false, // Send list of existing schedules?
  SEND_TELEGRAM_NEW_SCHEDULE: true,  // Send details of the new schedule?
  
  // --- Test Mode ---
  // true: Runs logic checks without switching relays.
  // false: Normal operation.
  IS_TEST_MODE: false, 
  TEST_INTERVAL_MINUTES: 5,

  // --- System Settings ---
  TIMEZONE: "Europe/Berlin",
  DATA_FETCH_TIME: "09:37"
};
```

### Weather API Configuration

This script uses the [Open-Meteo API](https://open-meteo.com/). You can customize the API request to get other data points or change settings like the timezone.

* **Find More Variables:** Detailed documentation for all available parameters can be found directly at Open-Meteo. You can use this example link to explore and customize:
    [https://api.open-meteo.com/v1/forecast?latitude=52.27&longitude=7.72&hourly=temperature_2m&timezone=Europe%2FBerlin](https://api.open-meteo.com/v1/forecast?latitude=52.27&longitude=7.72&hourly=temperature_2m&timezone=Europe%2FBerlin)

---

## 🤝 Contributing

Contributions, ideas, and bug reports are welcome! Feel free to open an issue or submit a pull request.

## 📄 License

This project is licensed under the MIT License.
