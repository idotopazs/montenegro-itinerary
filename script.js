let isEditingLocations = false;
// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyB_R7X8LmunLg0gQCi43QtX1zRpivj0Eyc",
  authDomain: "monte-trip-explorer.firebaseapp.com",
  databaseURL: "https://monte-trip-explorer-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "monte-trip-explorer",
  storageBucket: "monte-trip-explorer.appspot.com",
  messagingSenderId: "276849748308",
  appId: "1:276849748308:web:104aea5ee9e0bacbdec0c1",
  measurementId: "G-3Z0HS0SZJP"
};
// Initialize Firebase
firebase.initializeApp(firebaseConfig);
console.log("Firebase initialized:", firebase.app().name);
const database = firebase.database();
console.log("Database reference created");
let tripData = [];
let map, currentDay, currentMarker, currentRoute, markers = [],
  routeControls = [],
  isRemovingLocations = false;
//const openRouteServiceApiKey = '5b3ce3597851110001cf6248c50123909d9a458db7d4a37dcdc1c22b';
const openRouteServiceApiKey = '5b3ce3597851110001cf6248ace5e01ba6d9422197bb9f60656279cf';
const API_KEY = '2be03c1bd6f3f4edeab87cfdafe723b3'; // Replace with your actual OpenWeatherMap API key
let routeCache = {};

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

function initializeApp() {
  console.log("Initializing app with tripData:", tripData);
  console.log("Initial routeCache state:", routeCache);
  if (Array.isArray(tripData) && tripData.length > 0 && tripData[0].day) {
    createDayButtons();
    initializeMap();
    showDay(tripData[0]);
    // Fit the map to show all locations
    const allLocations = tripData.flatMap(day => [day.location, ...(day.locations || []).map(loc => loc.coords)]).filter(loc => loc);
    if (allLocations.length > 0) {
      map.fitBounds(L.latLngBounds(allLocations));
    }
    updateAccommodationList(); // Add this line
  } else {
    console.error("Invalid tripData structure:", tripData);
    tripData = getDefaultTripData();
    createDayButtons();
    initializeMap();
    showDay(tripData[0]);
  }
}

function initializeMap() {
  map = L.map('map').setView([42.7087, 19.3744], 11);
  let currentMarker = null;
  let currentRoute = null;
  let markers = [];
  let currentDay = null;
  let routeControls = [];
  let isRemovingLocations = false;
  let isEditingLocations = false;
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
  // Add the streets layer to the map by default
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

function createDayButtons() {
  const dayButtons = document.getElementById('dayButtons');
  dayButtons.innerHTML = ''; // Clear existing buttons
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
  updateWeather(day.date, day.location[0], day.location[1]);
  updateLocationsList();
  updateAccommodationList(); // Add this line
}

function getRouteFromCache(waypoints) {
  const cacheKey = waypoints.map(wp => `${wp[0].toFixed(6)}.${wp[1].toFixed(6)}`).join('|');
  return routeCache[cacheKey];
}

function generateCacheKey(waypoints) {
  return waypoints.map(wp => `${wp[0].toFixed(6)}.${wp[1].toFixed(6)}`).join('|');
}

function updateMap() {
  console.log("Starting updateMap. Current routeCache:", routeCache);
  map.eachLayer(layer => {
    if (layer instanceof L.Marker || layer instanceof L.Polyline) {
      map.removeLayer(layer);
    }
  });
  tripData.forEach((day, index) => {
    const dayColor = `hsl(${(day.day * 360) / tripData.length}, 70%, 50%)`;
    // Add marker for the day's origin
    if (day.location) {
      L.marker(day.location, {
        icon: L.divIcon({
          className: 'custom-div-icon',
          html: ` <div style="
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
        <span style="
            transform: rotate(45deg);
            display: flex;
            justify-content: center;
            align-items: center;
            width: 20px;
            height: 20px;
            font-size: 20px;
            font-weight: bold;
            color: white;
            background-color: rgba(0,0,0,0.5);
            border: 2px solid black;
            border-radius: 50%;
        ">${day.day}</span>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15]
        })
      }).addTo(map).bindPopup(`Day ${day.day} Origin`);
    }
    // Add markers for additional locations
    if (day.locations && Array.isArray(day.locations)) {
      day.locations.forEach(loc => {
        if (loc.coords) {
          L.marker(loc.coords, {
            icon: L.divIcon({
              className: 'custom-div-icon',
              html: `<div style="
        background-color: ${dayColor};
        border-radius: 50% 50% 50% 0;
        border: 2px solid black;
        width: 15px;
        height: 15px;
        transform: rotate(-45deg);
        position: relative;
        overflow: hidden;
    ">
        <div style="
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%) rotate(45deg);
            width: 5px;
            height: 5px;
            background-color: white;
            border-radius: 50%;
        "></div>`,
              iconSize: [20, 20],
              iconAnchor: [10, 10]
            })
          }).addTo(map).bindPopup(loc.name || 'Unnamed Location');
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
      background-color:  ${dayColor};
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
    // Create route
    let waypoints = [];
    if (day.location) {
      waypoints.push(day.location);
    }
    if (day.locations && Array.isArray(day.locations)) {
      waypoints = waypoints.concat(day.locations.filter(loc => loc.coords).map(loc => loc.coords));
    }
    if (day.accommodation && Array.isArray(day.accommodation)) {
      waypoints = waypoints.concat(day.accommodation.filter(acc => acc.coords).map(acc => acc.coords));
    }
    if (index < tripData.length - 1 && tripData[index + 1].location) {
      waypoints.push(tripData[index + 1].location);
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
  // Set view to the current day's location with a fixed zoom level
  if (currentDay.location) {
    map.setView(currentDay.location, 14);
  }
}

function fetchRoutes(routesToFetch) {
  routesToFetch.forEach(route => {
    fetchRoute(route.waypoints, route.dayColor, route.cacheKey);
  });
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

function saveRouteCache() {
  database.ref('routeCache').set(routeCache)
    .then(() => console.log("Route cache saved to Firebase"))
    .catch(error => console.error("Error saving route cache to Firebase:", error));
}

function drawRoute(route, color) {
  // Draw the border (black outline)
  L.polyline(route.map(coord => [coord[1], coord[0]]), {
    color: 'black',
    weight: 7, // Slightly larger than the main route
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

function updateActivities() {
  const activitiesDiv = document.getElementById('activities');
  activitiesDiv.innerHTML = `
            <h3>Day ${currentDay.day} (${currentDay.date}) Activities:</h3>
            <ul id="activitiesList">
                ${currentDay.activities.map(activity => `<li>${activity}</li>`).join('')}
            </ul>
            <button class="edit-button"class="edit-button" onclick="editActivities()">Edit Activities</button>
        `;
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
  const weatherDate = document.getElementById('weatherDate');
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
    '01d': '☀️',
    '01n': '🌙',
    '02d': '⛅',
    '02n': '☁️',
    '03d': '☁️',
    '03n': '☁️',
    '04d': '☁️',
    '04n': '☁️',
    '09d': '🌧️',
    '09n': '🌧️',
    '10d': '🌦️',
    '10n': '🌧️',
    '11d': '⛈️',
    '11n': '⛈️',
    '13d': '❄️',
    '13n': '❄️',
    '50d': '🌫️',
    '50n': '🌫️'
  };
  return iconMap[iconCode] || '☁️';
}

function updateLocationsList() {
  const locationsList = document.getElementById('locationsList');
  locationsList.innerHTML = '';
  if (currentDay.locations && Array.isArray(currentDay.locations)) {
    currentDay.locations.forEach((loc, index) => {
      if (loc.coords) {
        const li = document.createElement('li');
        const a = document.createElement('a');
        if (loc.link) {
          a.href = loc.link;
        } else {
          a.href = `https://www.google.com/maps/dir/?api=1&destination=${loc.coords[0]},${loc.coords[1]}`;
        }
        a.target = '_blank';
        a.textContent = loc.name || 'Unnamed Location';
        const coords = document.createElement('span');
        coords.className = 'location-coordinates';
        //coords.textContent = `(${loc.coords[0].toFixed(4)}, ${loc.coords[1].toFixed(4)})`;
        li.appendChild(a);
        li.appendChild(coords);
        if (isRemovingLocations) {
          const removeBtn = document.createElement('span');
          removeBtn.className = 'remove-location';
          removeBtn.textContent = ' ❌';
          removeBtn.onclick = () => removeLocation(index);
          li.appendChild(removeBtn);
        } else if (isEditingLocations) {
          const pinIcon = document.createElement('span');
          pinIcon.className = 'edit-location-pin';
          pinIcon.textContent = ' 📍';
          pinIcon.style.cursor = 'pointer';
          pinIcon.onclick = () => updateLocationCoordinates(index);
          const linkIcon = document.createElement('span');
          linkIcon.className = 'edit-location-link';
          linkIcon.textContent = ' 🔗';
          linkIcon.style.cursor = 'pointer';
          linkIcon.onclick = (e) => {
            e.stopPropagation(); // Prevent event from bubbling up
            editLocationLink(index);
          };
          li.appendChild(pinIcon);
          li.appendChild(linkIcon);
        }
        locationsList.appendChild(li);
      }
    });
  }
  if (currentDay.location) {
    document.getElementById('origin').textContent = `${currentDay.location[0].toFixed(4)}, ${currentDay.location[1].toFixed(4)}`;
  }
}

function editActivities() {
  const activitiesDiv = document.getElementById('activities');
  const currentActivities = currentDay.activities.join('\n');
  activitiesDiv.innerHTML = `
            <h3>Edit Day ${currentDay.day} (${currentDay.date}) Activities:</h3>
            <textarea id="editActivitiesArea" class="edit-area">${currentActivities}</textarea>
            <button class="edit-button" onclick="saveActivities()">Save Activities</button>
        `;
}

function saveActivities() {
  const editedActivities = document.getElementById('editActivitiesArea').value.split('\n').filter(activity => activity.trim() !== '');
  currentDay.activities = editedActivities;
  showDay(currentDay);
  saveToFirebase();
}

function openInGoogleMaps(query) {
  const baseUrl = 'https://www.google.com/maps/search/?api=1&query=';
  const encodedQuery = encodeURIComponent(query);
  const fullUrl = baseUrl + encodedQuery;
  window.open(fullUrl, '_blank');
}

function openWeatherWebsite(date) {
  const formattedDate = date.split('/').reverse().join('-');
  const weatherUrl = `https://www.accuweather.com/en/me/podgorica/298465/daily-weather-forecast/${formattedDate}`;
  window.open(weatherUrl, '_blank');
}
document.getElementById('addLocationBtn').addEventListener('click', function() {
  map.once('click', function(e) {
    const locationName = prompt("Enter location name:");
    if (locationName) {
      if (!currentDay.locations) {
        currentDay.locations = [];
      }
      currentDay.locations.push({
        name: locationName,
        coords: [e.latlng.lat, e.latlng.lng]
      });
      clearRouteCache();
      updateMap();
      updateLocationsList();
      saveToFirebase();
    }
  });
});
document.getElementById('editOriginBtn').addEventListener('click', function() {
  map.once('click', function(e) {
    currentDay.location = [e.latlng.lat, e.latlng.lng];
    clearRouteCache();
    updateMap();
    updateLocationsList();
    updateWeather(currentDay.date, e.latlng.lat, e.latlng.lng); // Update weather with new coordinates
    saveToFirebase();
  });
});
document.getElementById('removeLocationsBtn').addEventListener('click', function() {
  isRemovingLocations = !isRemovingLocations;
  this.textContent = isRemovingLocations ? 'Done Removing' : 'Remove Locations';
  updateLocationsList();
});

function removeLocation(index) {
  currentDay.locations.splice(index, 1);
  clearRouteCache();
  updateMap();
  updateLocationsList();
  saveToFirebase();
}
document.getElementById('editLocationsBtn').addEventListener('click', function() {
  isEditingLocations = !isEditingLocations;
  this.textContent = isEditingLocations ? 'Done Editing' : 'Edit Locations';
  updateLocationsList();
});


function editLocationLink(index) {
  const location = currentDay.locations[index];
  const newLink = prompt(`Enter new link for ${location.name || 'this location'}:`, location.link || '');
  if (newLink !== null) {
    location.link = newLink;
    updateLocationsList();
    saveToFirebase();
  }
}
let editingLocationIndex = null;

function updateLocationCoordinates(index) {
  editingLocationIndex = index;
  alert('Click on the map to set the new location');
  // Enable map click listener
  map.once('click', function(e) {
    const newLat = e.latlng.lat;
    const newLng = e.latlng.lng;
    currentDay.locations[editingLocationIndex].coords = [newLat, newLng];
    editingLocationIndex = null;
    clearRouteCache();
    updateMap();
    updateLocationsList();
    saveToFirebase();
  });
}

function showAccommodationInput() {
  alert('Click on the map to add an accommodation');
  map.once('click', addAccommodationOnMap);
}

function addAccommodationOnMap(e) {
  const lat = e.latlng.lat;
  const lng = e.latlng.lng;
  const name = prompt("Enter accommodation name:");
  if (name) {
    if (!currentDay.accommodation) {
      currentDay.accommodation = [];
    }
    const newAccommodation = {
      name: name,
      address: `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
      coords: [lat, lng]
    };
    currentDay.accommodation.push(newAccommodation);
    // Add marker to the map
    L.marker([lat, lng]).addTo(map)
      .bindPopup(name)
      .openPopup();
    // Create route from day's origin to new accommodation
    if (currentDay.location) {
      const waypoints = [
        currentDay.location,
        [lat, lng]
      ];
      fetchRoute(waypoints, 'blue', generateCacheKey(waypoints));
    }
    updateAccommodationList();
    saveToFirebase();
  }
}

function hideAccommodationInput() {
  document.getElementById('accommodationInput').style.display = 'none';
  document.getElementById('addAccommodation').style.display = 'block';
  clearAccommodationInput();
}

function clearAccommodationInput() {
  document.getElementById('accommodationName').value = '';
  document.getElementById('accommodationAddress').value = '';
}

function saveAccommodation() {
  const name = document.getElementById('accommodationName').value;
  const address = document.getElementById('accommodationAddress').value;
  if (name && address) {
    if (!currentDay.accommodation) {
      currentDay.accommodation = [];
    }
    currentDay.accommodation.push({
      name,
      address
    });
    updateAccommodationList();
    hideAccommodationInput();
    saveToFirebase();
  }
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

function editAccommodations() {
  const list = document.getElementById('accommodationList');
  list.innerHTML = '';
  if (currentDay.accommodation && Array.isArray(currentDay.accommodation)) {
    currentDay.accommodation.forEach((accommodation, index) => {
      const li = document.createElement('li');
      const nameInput = document.createElement('input');
      nameInput.value = accommodation.name;
      const addressInput = document.createElement('input');
      addressInput.value = accommodation.address;
      const saveBtn = document.createElement('button');
      saveBtn.textContent = 'Save';
      saveBtn.onclick = () => {
        currentDay.accommodation[index] = {
          name: nameInput.value,
          address: addressInput.value
        };
        saveToFirebase();
        updateAccommodationList();
      };
      li.appendChild(nameInput);
      li.appendChild(addressInput);
      li.appendChild(saveBtn);
      list.appendChild(li);
    });
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
let isRemovingAccommodations = false;
let isEditingAccommodations = false;
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

function logTripData() {
  database.ref('tripData').once('value')
    .then((snapshot) => {
      console.log(JSON.stringify(snapshot.val(), null, 2));
    })
    .catch((error) => {
      console.error("Error fetching trip data:", error);
    });
}
const modeToggle = document.getElementById('modeToggle');
const editButtons = document.querySelectorAll('.edit-button, .remove-button, .add-button');
let editMode = true;
modeToggle.addEventListener('click', () => {
  editMode = !editMode;
  modeToggle.textContent = editMode ? 'Edit Mode' : 'View Mode';
  editButtons.forEach(button => {
    button.style.display = editMode ? 'inline-block' : 'none';
  });
});
//function deleteFirebaseCache() {
// console.log("Attempting to delete Firebase cache...");
//database.ref('routeCache').remove()
// .then(() => {
//  console.log("Firebase cache successfully deleted");
//  routeCache = {}; // Clear the local cache as well
// })
// .catch((error) => {
//  console.error("Error deleting Firebase cache:", error);
// });
//}
function getDefaultTripData() {
  // Return your default trip data here
  return [{
      date: '24/9',
      day: 1,
      activities: ['Landing and drive to the hotel in the city of Kotor', 'A ride to the cable car + a mountain slide + a view of Kotor', 'Accommodation in Kotor'],
      location: [42.4246, 18.7712],
      restaurants: [{
          name: 'Galion',
          cuisine: 'Seafood',
          rating: 4.5,
          priceRange: '€€€',
          address: 'Suranj bb, Kotor 85330 Montenegro',
          description: 'Upscale dining with panoramic views of the Bay of Kotor.'
        },
        // ... other restaurants ...
      ],
      locations: [{
          name: 'Kotor Old Town',
          coords: [42.4246, 18.7712]
        },
        {
          name: 'Kotor Cable Car',
          coords: [42.4255, 18.7711]
        }
      ]
    },
    // ... other days ...
  ];
}
document.addEventListener('DOMContentLoaded', () => {
  if (tripData && tripData.length > 0) {
    const firstDay = tripData[0];
    const cityName = firstDay.location[2] || firstDay.location || 'Unknown';
    updateWeather(firstDay.date, cityName);
  }
});
loadFromFirebase();