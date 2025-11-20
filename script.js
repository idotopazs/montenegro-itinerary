// ========================================
// Global Variables
// ========================================
let isRemovingAccommodations = false;
let isEditingAccommodations = false;
let isEditingActivities = false;
let isRemovingActivities = false;
let editMode = true;

let tripData = [];
let map, currentDay, currentMarker, currentRoute;
let markers = [];
let routeControls = [];
let routeCache = {};

// API Keys
const openRouteServiceApiKey = '5b3ce3597851110001cf6248ace5e01ba6d9422197bb9f60656279cf';
const API_KEY = '2be03c1bd6f3f4edeab87cfdafe723b3';

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyB_R7X8LmunLg0gQCi43QtX1zRpivj0Eyc",
  authDomain: "monte-trip-explorer.firebaseapp.com",
  databaseURL: "https://monte-trip-explorer-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "monte-trip-explorer",
  storageBucket: "monte-trip-explorer.firebasestorage.app",
  messagingSenderId: "276849748308",
  appId: "1:276849748308:web:104aea5ee9e0bacbdec0c1",
  measurementId: "G-3Z0HS0SZJP"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
console.log("Firebase initialized:", firebase.app().name);
const database = firebase.database();
console.log("Database reference created");

// ========================================
// Firebase Operations
// ========================================
function loadFromFirebase() {
  console.log("Starting to load data from Firebase");
  Promise.all([
    database.ref('tripData').once('value'),
    database.ref('routeCache').once('value')
  ])
    .then(([tripDataSnapshot, routeCacheSnapshot]) => {
      console.log("Firebase tripData snapshot:", tripDataSnapshot.val());
      console.log("Firebase routeCache snapshot:", routeCacheSnapshot.val());

      if (tripDataSnapshot.exists()) {
        tripData = tripDataSnapshot.val();
        if (!Array.isArray(tripData) || tripData.length === 0) {
          console.error("Invalid data structure in Firebase:", tripData);
          throw new Error("Invalid data structure in Firebase");
        }
      } else {
        console.log("No trip data in Firebase, initializing with default data");
        tripData = getDefaultTripData();
      }

      if (routeCacheSnapshot.exists()) {
        const loadedCache = routeCacheSnapshot.val();
        routeCache = {};
        // Convert loaded cache keys to the new format
        Object.keys(loadedCache).forEach(key => {
          const newKey = key.replace(/_/g, '.').split('|').map(coord => coord.replace('_', ',')).join('|');
          routeCache[newKey] = loadedCache[key];
        });
        console.log("Route cache loaded and converted from Firebase:", routeCache);
      } else {
        console.log("No route cache in Firebase, initializing empty cache");
        routeCache = {};
      }

      console.log("Final routeCache after loading:", routeCache);
      initializeApp();
    })
    .catch((error) => {
      console.error("Detailed error loading data from Firebase:", error);
      tripData = getDefaultTripData();
      routeCache = {};
      initializeApp();
    });
}

function saveToFirebase() {
  Promise.all([
    database.ref('tripData').set(tripData),
    database.ref('routeCache').set(routeCache)
  ])
    .then(() => {
      console.log("Data and route cache saved successfully to Firebase");
    })
    .catch((error) => {
      console.error("Error saving data to Firebase:", error);
    });
}

function logTripData() {
  database.ref('tripData').once('value')
    .then((snapshot) => {
      console.log(JSON.stringify(snapshot.val(), null, 2));
    })
    .catch((error) => {
      console.error("Error fetching trip data:", error);
    });
}

// ========================================
// Application Initialization
// ========================================
function initializeApp() {
  console.log("Initializing app with tripData:", tripData);
  console.log("Initial routeCache state:", routeCache);

  if (Array.isArray(tripData) && tripData.length > 0 && tripData[0].day) {
    createDayButtons();
    initializeMap();
    showDay(tripData[0]);

    // Fit the map to show all accommodations and activities
    const allLocations = tripData.flatMap(day => {
      const coords = [];
      if (day.accommodation) {
        coords.push(...day.accommodation.filter(a => a.coords).map(a => a.coords));
      }
      if (day.activities) {
        coords.push(...day.activities.filter(a => a.coords).map(a => a.coords));
      }
      return coords;
    }).filter(loc => loc);

    if (allLocations.length > 0) {
      map.fitBounds(L.latLngBounds(allLocations));
    }
    updateAccommodationList();
  } else {
    console.error("Invalid tripData structure:", tripData);
    tripData = getDefaultTripData();
    createDayButtons();
    initializeMap();
    showDay(tripData[0]);
  }
}

// ========================================
// Map Initialization
// ========================================
function initializeMap() {
  map = L.map('map').setView([42.7087, 19.3744], 11);

  // Define the base layers using Esri tile layers
  const streets = L.esri.basemapLayer('Streets');
  const satellite = L.esri.basemapLayer('Imagery');
  const satelliteWithLabels = L.layerGroup([
    L.esri.basemapLayer('Imagery'),
    L.esri.basemapLayer('ImageryLabels')
  ]);

  // Add OpenStreetMap as a fallback
  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
  });

  // Add the OSM layer to the map by default
  osm.addTo(map);

  // Create a layer control
  const baseMaps = {
    "Streets": streets,
    "Satellite": satellite,
    "Satellite with Labels": satelliteWithLabels,
    "OpenStreetMap": osm
  };

  L.control.layers(baseMaps).addTo(map);
}

// ========================================
// UI Updates
// ========================================
function createDayButtons() {
  const dayButtons = document.getElementById('dayButtons');
  dayButtons.innerHTML = '';

  tripData.forEach(day => {
    const button = document.createElement('button');
    button.className = 'day-button';
    button.textContent = `Day ${day.day} (${day.date})`;
    button.onclick = () => showDay(day);
    dayButtons.appendChild(button);
  });
}

function showDay(day) {
  if (!day) {
    console.error('Invalid day data:', day);
    return;
  }

  currentDay = day;
  document.querySelectorAll('.day-button').forEach(btn => btn.classList.remove('active'));

  const activeButton = document.querySelector(`.day-button:nth-child(${day.day})`);
  if (activeButton) {
    activeButton.classList.add('active');
  }

  updateMap();
  updateActivities();
  updateRestaurants();

  // Use accommodation as origin for weather, fallback to location
  let originCoords = day.location;
  if (day.accommodation && day.accommodation.length > 0 && day.accommodation[0].coords) {
    originCoords = day.accommodation[0].coords;
  }
  if (originCoords) {
    updateWeather(day.date, originCoords[0], originCoords[1]);
  }
  updateAccommodationList();
}

function updateActivities() {
  const activitiesDiv = document.getElementById('activities');

  // Ensure activities is an array of objects
  if (!currentDay.activities) {
    currentDay.activities = [];
  }

  // Convert old string-based activities to object-based
  if (currentDay.activities.length > 0 && typeof currentDay.activities[0] === 'string') {
    currentDay.activities = currentDay.activities.map(activity => ({
      name: activity,
      coords: null,
      link: ''
    }));
  }

  // Migrate old locations to activities (one-time migration)
  if (currentDay.locations && Array.isArray(currentDay.locations) && currentDay.locations.length > 0) {
    currentDay.locations.forEach(loc => {
      if (loc.coords) {
        currentDay.activities.push({
          name: loc.name || 'Unnamed Location',
          coords: loc.coords,
          link: loc.link || ''
        });
      }
    });
    delete currentDay.locations;
    saveToFirebase();
  }

  activitiesDiv.innerHTML = `
    <h3>Day ${currentDay.day} Activities</h3>
    <button id="addActivityBtn" class="add-button">Add Activity</button>
    <ul id="activitiesList"></ul>
    <div id="activityButtons">
      <button id="editActivitiesBtn" class="edit-button">Edit Activities</button>
      <button id="removeActivitiesBtn" class="remove-button">Remove Activities</button>
    </div>
  `;

  updateActivitiesList();

  // Add event listeners
  document.getElementById('addActivityBtn').addEventListener('click', addActivity);
  document.getElementById('editActivitiesBtn').addEventListener('click', toggleEditActivities);
  document.getElementById('removeActivitiesBtn').addEventListener('click', toggleRemoveActivities);
}

function updateActivitiesList() {
  const activitiesList = document.getElementById('activitiesList');
  if (!activitiesList) return;

  activitiesList.innerHTML = '';

  if (currentDay.activities && Array.isArray(currentDay.activities)) {
    currentDay.activities.forEach((activity, index) => {
      const li = document.createElement('li');
      const a = document.createElement('a');

      if (activity.link) {
        a.href = activity.link;
      } else if (activity.coords) {
        a.href = `https://www.google.com/maps/dir/?api=1&destination=${activity.coords[0]},${activity.coords[1]}`;
      } else {
        a.href = '#';
        a.onclick = (e) => e.preventDefault();
      }

      a.target = '_blank';
      a.textContent = activity.name || 'Unnamed Activity';

      li.appendChild(a);

      if (isRemovingActivities) {
        const removeBtn = document.createElement('span');
        removeBtn.className = 'remove-activity';
        removeBtn.textContent = ' ❌';
        removeBtn.onclick = () => removeActivity(index);
        li.appendChild(removeBtn);
      } else if (isEditingActivities) {
        const editNameIcon = document.createElement('span');
        editNameIcon.className = 'edit-activity-name';
        editNameIcon.textContent = ' ✏️';
        editNameIcon.style.cursor = 'pointer';
        editNameIcon.onclick = () => editActivityName(index);

        const pinIcon = document.createElement('span');
        pinIcon.className = 'edit-activity-pin';
        pinIcon.textContent = ' 📍';
        pinIcon.style.cursor = 'pointer';
        pinIcon.onclick = () => updateActivityCoordinates(index);

        const linkIcon = document.createElement('span');
        linkIcon.className = 'edit-activity-link';
        linkIcon.textContent = ' 🔗';
        linkIcon.style.cursor = 'pointer';
        linkIcon.onclick = (e) => {
          e.stopPropagation();
          editActivityLink(index);
        };

        li.appendChild(editNameIcon);
        li.appendChild(pinIcon);
        li.appendChild(linkIcon);
      }

      activitiesList.appendChild(li);
    });
  }
}

function updateRestaurants() {
  const restaurantsDiv = document.getElementById('restaurants');
  restaurantsDiv.innerHTML = `<h3>Recommended Restaurants:</h3>` +
    currentDay.restaurants.map(restaurant => `
      <div class="restaurant-card" onclick="openInGoogleMaps('${restaurant.name}, ${restaurant.address}')">
        <div class="restaurant-name">${restaurant.name}</div>
        <div class="restaurant-details">
          <span class="restaurant-cuisine">${restaurant.cuisine}</span> |
          <span class="restaurant-rating">★ ${restaurant.rating}</span> |
          <span class="restaurant-price">${restaurant.priceRange}</span>
        </div>
        <div class="restaurant-description">${restaurant.description}</div>
      </div>
    `).join('');
}

function updateAccommodationList() {
  const list = document.getElementById('accommodationList');
  list.innerHTML = '';

  if (currentDay.accommodation && Array.isArray(currentDay.accommodation)) {
    currentDay.accommodation.forEach((accommodation, index) => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(accommodation.address)}`;
      a.target = '_blank';
      a.textContent = `${accommodation.name} - ${accommodation.address}`;
      li.appendChild(a);

      if (isRemovingAccommodations) {
        const removeBtn = document.createElement('span');
        removeBtn.className = 'remove-accommodation';
        removeBtn.textContent = ' ❌';
        removeBtn.onclick = () => removeAccommodation(index);
        li.appendChild(removeBtn);
      } else if (isEditingAccommodations) {
        const pinIcon = document.createElement('span');
        pinIcon.className = 'edit-accommodation-pin';
        pinIcon.textContent = ' 📍';
        pinIcon.style.cursor = 'pointer';
        pinIcon.onclick = () => updateAccommodationCoordinates(index);

        const linkIcon = document.createElement('span');
        linkIcon.className = 'edit-accommodation-link';
        linkIcon.textContent = ' 🔗';
        linkIcon.style.cursor = 'pointer';
        linkIcon.onclick = (e) => {
          e.stopPropagation();
          editAccommodationLink(index);
        };

        li.appendChild(pinIcon);
        li.appendChild(linkIcon);
      }

      list.appendChild(li);
    });
  }
}

// ========================================
// Map Updates
// ========================================
function updateMap() {
  console.log("Starting updateMap. Current routeCache:", routeCache);

  map.eachLayer(layer => {
    if (layer instanceof L.Marker || layer instanceof L.Polyline) {
      map.removeLayer(layer);
    }
  });

  tripData.forEach((day, index) => {
    const dayColor = `hsl(${(day.day * 360) / tripData.length}, 70%, 50%)`;

    // Add markers for activities
    if (day.activities && Array.isArray(day.activities)) {
      day.activities.forEach(activity => {
        if (activity.coords) {
          L.marker(activity.coords, {
            icon: L.divIcon({
              className: 'custom-div-icon',
              html: `
                <div style="
                  background-color: ${dayColor};
                  border-radius: 50% 50% 50% 0;
                  border: 2px solid black;
                  width: 25px;
                  height: 25px;
                  display: flex;
                  justify-content: center;
                  align-items: center;
                  transform: rotate(-45deg);
                  position: relative;
                ">
                  <div style="
                    transform: rotate(45deg);
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    width: 10px;
                    height: 10px;
                  ">
                    <i class="fa fa-star" style="
                      font-size: 12px;
                      color: white;
                    "></i>
                  </div>
                </div>
              `,
              iconSize: [25, 25],
              iconAnchor: [12, 25]
            })
          }).addTo(map).bindPopup(activity.name || 'Unnamed Activity');
        }
      });
    }

    // Add markers for accommodations
    if (day.accommodation && Array.isArray(day.accommodation)) {
      day.accommodation.forEach(acc => {
        if (acc.coords) {
          L.marker(acc.coords, {
            icon: L.divIcon({
              className: 'custom-div-icon',
              html: `
                <div style="
                  background-color: ${dayColor};
                  border-radius: 50% 50% 50% 0;
                  border: 2px solid black;
                  width: 30px;
                  height: 30px;
                  display: flex;
                  justify-content: center;
                  align-items: center;
                  transform: rotate(-45deg);
                  position: relative;
                ">
                  <div style="
                    transform: rotate(45deg);
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    width: 10px;
                    height: 10px;
                  ">
                    <i class="fa fa-bed" style="
                      font-size: 14px;
                      color: white;
                    "></i>
                  </div>
                </div>
              `,
              iconSize: [60, 60],
              iconAnchor: [30, 60]
            })
          }).addTo(map).bindPopup(acc.name || 'Unnamed Accommodation');
        }
      });
    }

    // Create route - start from accommodation (origin)
    let waypoints = [];
    if (day.accommodation && Array.isArray(day.accommodation)) {
      waypoints = waypoints.concat(day.accommodation.filter(acc => acc.coords).map(acc => acc.coords));
    }
    if (day.activities && Array.isArray(day.activities)) {
      waypoints = waypoints.concat(day.activities.filter(act => act.coords).map(act => act.coords));
    }
    // Connect to next day's accommodation
    if (index < tripData.length - 1 && tripData[index + 1].accommodation && tripData[index + 1].accommodation.length > 0 && tripData[index + 1].accommodation[0].coords) {
      waypoints.push(tripData[index + 1].accommodation[0].coords);
    }

    if (waypoints.length > 1) {
      const cacheKey = generateCacheKey(waypoints);
      console.log("Attempting to draw route for:", cacheKey);
      console.log("Cache keys:", Object.keys(routeCache));

      if (routeCache[cacheKey]) {
        console.log("Using cached route for:", cacheKey);
        drawRoute(routeCache[cacheKey], dayColor);
      } else {
        console.log("Cache miss, fetching route for:", cacheKey);
        fetchRoute(waypoints, dayColor, cacheKey);
      }
    }
  });

  // Set view to the current day's accommodation with a fixed zoom level
  if (currentDay.accommodation && currentDay.accommodation.length > 0 && currentDay.accommodation[0].coords) {
    map.setView(currentDay.accommodation[0].coords, 14);
  } else if (currentDay.activities && currentDay.activities.length > 0) {
    const firstWithCoords = currentDay.activities.find(a => a.coords);
    if (firstWithCoords) {
      map.setView(firstWithCoords.coords, 14);
    }
  }
}

// ========================================
// Route Management
// ========================================
function generateCacheKey(waypoints) {
  return waypoints.map(wp => `${wp[0].toFixed(6)}.${wp[1].toFixed(6)}`).join('|');
}

function fetchRoute(waypoints, color, cacheKey) {
  if (!routeCache[cacheKey]) {
    console.log("Cache miss. Fetching route from API for:", cacheKey);
    const body = JSON.stringify({
      coordinates: waypoints.map(wp => [wp[1], wp[0]])
    });

    fetch('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
      method: 'POST',
      headers: {
        'Accept': 'application/json, application/geo+json, application/gpx+xml, img/png; charset=utf-8',
        'Content-Type': 'application/json',
        'Authorization': openRouteServiceApiKey
      },
      body: body
    })
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
      })
      .then(data => {
        if (data.features && data.features.length > 0) {
          const route = data.features[0].geometry.coordinates;
          routeCache[cacheKey] = route;
          drawRoute(route, color);

          // Save only the updated route to Firebase
          database.ref('routeCache/' + cacheKey.replace(/[.,]/g, '_')).set(route)
            .then(() => console.log("Route cache updated in Firebase for:", cacheKey))
            .catch(error => console.error("Error updating route cache in Firebase:", error));
        } else {
          console.error('No route found in the response:', data);
        }
      })
      .catch(error => {
        console.error('Error fetching route:', error);
      });
  } else {
    console.log("Using cached route for:", cacheKey);
    drawRoute(routeCache[cacheKey], color);
  }
}

function drawRoute(route, color) {
  // Draw the border (black outline)
  L.polyline(route.map(coord => [coord[1], coord[0]]), {
    color: 'black',
    weight: 7,
    opacity: 0.7
  }).addTo(map);

  // Draw the main route
  L.polyline(route.map(coord => [coord[1], coord[0]]), {
    color: color,
    weight: 5,
    opacity: 1
  }).addTo(map);
}

function clearRouteCache() {
  routeCache = {};
  database.ref('routeCache').remove()
    .then(() => console.log("Route cache cleared from Firebase"))
    .catch(error => console.error("Error clearing route cache from Firebase:", error));
}

// ========================================
// Weather
// ========================================
function updateWeather(date, lat, lon) {
  const weatherDate = document.getElementById('weatherDate');
  const temperature = document.getElementById('temperature');
  const humidity = document.getElementById('humidity');
  const weatherCondition = document.getElementById('weatherCondition');
  const weatherIcon = document.getElementById('weatherIcon');

  weatherDate.textContent = date;

  fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&APPID=${API_KEY}&units=metric`)
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response.json();
    })
    .then(data => {
      if (data.main && data.main.temp) {
        temperature.textContent = Math.round(data.main.temp);
        humidity.textContent = data.main.humidity;
        weatherCondition.textContent = data.weather[0].description;
        weatherIcon.textContent = getWeatherIcon(data.weather[0].icon);
      } else {
        throw new Error('Weather data is incomplete');
      }
    })
    .catch(error => {
      console.error('Error fetching weather data:', error);
      displayWeatherError();
    });
}

function displayWeatherError() {
  const temperature = document.getElementById('temperature');
  const humidity = document.getElementById('humidity');
  const weatherCondition = document.getElementById('weatherCondition');
  const weatherIcon = document.getElementById('weatherIcon');

  temperature.textContent = '❓';
  humidity.textContent = '❓';
  weatherCondition.textContent = 'Weather data unavailable';
  weatherIcon.textContent = '❓';
}

function getWeatherIcon(iconCode) {
  const iconMap = {
    '01d': '☀️', '01n': '🌙',
    '02d': '⛅', '02n': '☁️',
    '03d': '☁️', '03n': '☁️',
    '04d': '☁️', '04n': '☁️',
    '09d': '🌧️', '09n': '🌧️',
    '10d': '🌦️', '10n': '🌧️',
    '11d': '⛈️', '11n': '⛈️',
    '13d': '❄️', '13n': '❄️',
    '50d': '🌫️', '50n': '🌫️'
  };
  return iconMap[iconCode] || '☁️';
}

// ========================================
// Edit Functions
// ========================================
function addActivity() {
  alert('Click on the map to add an activity location (or press ESC to skip)');

  const onMapClick = function(e) {
    map.off('keydown', onEscPress);
    const activityName = prompt("Enter activity name:");
    if (activityName) {
      if (!currentDay.activities) {
        currentDay.activities = [];
      }
      currentDay.activities.push({
        name: activityName,
        coords: [e.latlng.lat, e.latlng.lng],
        link: ''
      });
      updateMap();
      updateActivitiesList();
      saveToFirebase();
    }
  };

  const onEscPress = function(e) {
    if (e.originalEvent.key === 'Escape') {
      map.off('click', onMapClick);
      map.off('keydown', onEscPress);
      const activityName = prompt("Enter activity name:");
      if (activityName) {
        if (!currentDay.activities) {
          currentDay.activities = [];
        }
        currentDay.activities.push({
          name: activityName,
          coords: null,
          link: ''
        });
        updateActivitiesList();
        saveToFirebase();
      }
    }
  };

  map.once('click', onMapClick);
  map.on('keydown', onEscPress);
}

function toggleEditActivities() {
  isEditingActivities = !isEditingActivities;
  if (isEditingActivities) {
    isRemovingActivities = false;
    document.getElementById('removeActivitiesBtn').textContent = 'Remove Activities';
  }
  document.getElementById('editActivitiesBtn').textContent =
    isEditingActivities ? 'Done Editing' : 'Edit Activities';
  updateActivitiesList();
}

function toggleRemoveActivities() {
  isRemovingActivities = !isRemovingActivities;
  if (isRemovingActivities) {
    isEditingActivities = false;
    document.getElementById('editActivitiesBtn').textContent = 'Edit Activities';
  }
  document.getElementById('removeActivitiesBtn').textContent =
    isRemovingActivities ? 'Done Removing' : 'Remove Activities';
  updateActivitiesList();
}

function editActivityName(index) {
  const activity = currentDay.activities[index];
  const newName = prompt(`Edit activity name:`, activity.name || '');
  if (newName !== null && newName.trim() !== '') {
    activity.name = newName;
    updateActivitiesList();
    saveToFirebase();
  }
}

function updateActivityCoordinates(index) {
  alert('Click on the map to set the activity location');

  map.once('click', function(e) {
    const newLat = e.latlng.lat;
    const newLng = e.latlng.lng;
    currentDay.activities[index].coords = [newLat, newLng];
    clearRouteCache();
    updateMap();
    updateActivitiesList();
    saveToFirebase();
  });
}

function removeActivity(index) {
  currentDay.activities.splice(index, 1);
  clearRouteCache();
  updateMap();
  updateActivitiesList();
  saveToFirebase();
}

function editActivityLink(index) {
  const activity = currentDay.activities[index];
  const newLink = prompt(`Enter new link for ${activity.name || 'this activity'}:`, activity.link || '');
  if (newLink !== null) {
    activity.link = newLink;
    updateActivitiesList();
    saveToFirebase();
  }
}

function updateAccommodationCoordinates(index) {
  alert('Click on the map to set the new accommodation location');
  map.once('click', function(e) {
    const newLat = e.latlng.lat;
    const newLng = e.latlng.lng;
    currentDay.accommodation[index].coords = [newLat, newLng];
    currentDay.accommodation[index].address = `${newLat.toFixed(6)}, ${newLng.toFixed(6)}`;
    clearRouteCache();
    updateMap();
    updateAccommodationList();
    saveToFirebase();
  });
}

function removeAccommodation(index) {
  currentDay.accommodation.splice(index, 1);
  clearRouteCache();
  updateMap();
  updateAccommodationList();
  saveToFirebase();
}

function editAccommodationLink(index) {
  const accommodation = currentDay.accommodation[index];
  const newLink = prompt(`Enter new link for ${accommodation.name || 'this accommodation'}:`, accommodation.link || '');
  if (newLink !== null) {
    accommodation.link = newLink;
    updateAccommodationList();
    saveToFirebase();
  }
}

// ========================================
// Day Management Functions
// ========================================
function addDay() {
  const date = prompt("Enter date for the new day (e.g., 25/9):");
  if (date) {
    const newDayNumber = tripData.length + 1;
    const newDay = {
      date: date,
      day: newDayNumber,
      activities: [],
      accommodation: [],
      restaurants: []
    };
    tripData.push(newDay);
    clearRouteCache();
    createDayButtons();
    showDay(newDay);
    saveToFirebase();
  }
}

function removeCurrentDay() {
  if (tripData.length <= 1) {
    alert("Cannot remove the last day. You need at least one day.");
    return;
  }

  if (confirm(`Are you sure you want to remove Day ${currentDay.day} (${currentDay.date})?`)) {
    const dayIndex = tripData.findIndex(d => d.day === currentDay.day);
    tripData.splice(dayIndex, 1);

    // Renumber remaining days
    tripData.forEach((day, index) => {
      day.day = index + 1;
    });

    clearRouteCache();
    createDayButtons();
    showDay(tripData[0]);
    saveToFirebase();
  }
}

// ========================================
// Helper Functions
// ========================================
function openInGoogleMaps(query) {
  const baseUrl = 'https://www.google.com/maps/search/?api=1&query=';
  const encodedQuery = encodeURIComponent(query);
  const fullUrl = baseUrl + encodedQuery;
  window.open(fullUrl, '_blank');
}

function getDefaultTripData() {
  return [{
    date: '24/9',
    day: 1,
    activities: [
      {
        name: 'Landing and drive to the hotel in the city of Kotor',
        coords: [42.4246, 18.7712],
        link: ''
      },
      {
        name: 'Kotor Cable Car + mountain slide + view of Kotor',
        coords: [42.4255, 18.7711],
        link: ''
      }
    ],
    accommodation: [{
      name: 'Hotel in Kotor',
      address: 'Kotor Old Town',
      coords: [42.4246, 18.7712]
    }],
    restaurants: [{
      name: 'Galion',
      cuisine: 'Seafood',
      rating: 4.5,
      priceRange: '€€€',
      address: 'Suranj bb, Kotor 85330 Montenegro',
      description: 'Upscale dining with panoramic views of the Bay of Kotor.'
    }]
  }];
}

// ========================================
// Event Listeners
// ========================================
document.getElementById('addDayBtn').addEventListener('click', addDay);
document.getElementById('removeDayBtn').addEventListener('click', removeCurrentDay);

document.getElementById('addAccommodationBtn').addEventListener('click', function() {
  alert('Click on the map to add an accommodation');
  map.once('click', function(e) {
    const name = prompt("Enter accommodation name:");
    if (name) {
      if (!currentDay.accommodation) {
        currentDay.accommodation = [];
      }
      currentDay.accommodation.push({
        name: name,
        address: `${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`,
        coords: [e.latlng.lat, e.latlng.lng]
      });
      clearRouteCache();
      updateMap();
      updateAccommodationList();
      saveToFirebase();
    }
  });
});

document.getElementById('editAccommodationsBtn').addEventListener('click', function() {
  isEditingAccommodations = !isEditingAccommodations;
  this.textContent = isEditingAccommodations ? 'Done Editing' : 'Edit Accomm';
  updateAccommodationList();
});

document.getElementById('removeAccommodationsBtn').addEventListener('click', function() {
  isRemovingAccommodations = !isRemovingAccommodations;
  this.textContent = isRemovingAccommodations ? 'Done Removing' : 'Remove Accomm';
  updateAccommodationList();
});

const modeToggle = document.getElementById('modeToggle');
const editButtons = document.querySelectorAll('.edit-button, .remove-button, .add-button');

modeToggle.addEventListener('click', () => {
  editMode = !editMode;
  modeToggle.textContent = editMode ? 'Edit Mode' : 'View Mode';
  editButtons.forEach(button => {
    button.style.display = editMode ? 'inline-block' : 'none';
  });
});

// ========================================
// Initialize on Load
// ========================================
loadFromFirebase();
