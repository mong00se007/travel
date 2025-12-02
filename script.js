// State Management
let locations = JSON.parse(localStorage.getItem('travel_planner_locations')) || [];
let map;
let mapTileLayer;
let markers = [];
let travelTimeMarkers = [];
let polyline;
let tempClickCoords = null;
let currentTheme = localStorage.getItem('travel_planner_theme') || 'dark';

// DOM Elements
const locationModal = document.getElementById('locationModal');
const locationForm = document.getElementById('locationForm');
const itineraryList = document.getElementById('itineraryList');
const locationCount = document.getElementById('locationCount');
const resetBtn = document.getElementById('resetBtn');
const themeToggleBtn = document.getElementById('themeToggle');
// Save button removed - app auto-saves to localStorage

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    renderApp();
    setupEventListeners();
    setupDragAndDrop();
});

// Map Initialization
function initMap() {
    // Default view (Europe)
    map = L.map('map', {
        dragging: !L.Browser.mobile
    }).setView([48.8566, 2.3522], 5);

    // Initialize with current theme
    setMapTheme(currentTheme);
    updateThemeIcon();

    // Map Click Handler
    map.on('click', (e) => {
        tempClickCoords = e.latlng;
        openModal();
    });
}

// Set Map Theme
function setMapTheme(theme) {
    // Remove existing tile layer if it exists
    if (mapTileLayer) {
        map.removeLayer(mapTileLayer);
    }

    if (theme === 'dark') {
        // Dark mode - CartoDB Dark Matter
        mapTileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: 20
        }).addTo(map);
    } else {
        // Light mode - ArcGIS NatGeo World Map
        mapTileLayer = L.tileLayer('http://services.arcgisonline.com/arcgis/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}', {
            attribution: '&copy; <a href="https://www.esri.com">Esri</a>, NatGeo',
            maxZoom: 20
        }).addTo(map);
    }
}

// Toggle Theme

function toggleTheme() {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('travel_planner_theme', currentTheme);

    setMapTheme(currentTheme);
    updateThemeIcon();
    renderMapElements(); // Re-render to update polyline color
}

// Update Theme Icon
function updateThemeIcon() {
    const icon = themeToggleBtn.querySelector('i');
    if (currentTheme === 'dark') {
        icon.className = 'fa-solid fa-moon';
    } else {
        icon.className = 'fa-solid fa-sun';
    }
}

// Render App (Map Markers + Itinerary Cards)
function renderApp() {
    renderMapElements();
    renderItineraryList();
    updateStats();
}

// Calculate distance between two points (Haversine formula)
function calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance in km
}

// Estimate travel time based on mode and distance
function estimateTravelTime(distance, mode) {
    // Average speeds in km/h
    const speeds = {
        'walking': 5,
        'biking': 15,
        'car': 40,  // Reduced from 60 to add ~50% more time for realistic estimates
        'boat': 30,
        'plane': 500
    };

    const speed = speeds[mode] || 50; // Default 50 km/h if no mode
    const hours = distance / speed;

    if (hours < 1) {
        const minutes = Math.round(hours * 60);
        return `~${minutes}min`;
    } else if (hours < 24) {
        const h = Math.floor(hours);
        const m = Math.round((hours - h) * 60);
        return m > 0 ? `~${h}h ${m}min` : `~${h}h`;
    } else {
        const days = Math.round(hours / 24 * 10) / 10;
        return `~${days} days`;
    }
}

// Render Map Elements (Markers & Polyline)
function renderMapElements() {
    // Clear existing
    markers.forEach(marker => map.removeLayer(marker));
    markers = [];
    travelTimeMarkers.forEach(marker => map.removeLayer(marker));
    travelTimeMarkers = [];
    if (polyline) map.removeLayer(polyline);

    // Add Markers
    locations.forEach((loc, index) => {
        const customIcon = L.divIcon({
            className: 'custom-map-marker',
            html: `<div style="
                background-color: #00d2ff;
                width: 30px;
                height: 30px;
                border-radius: 50%;
                border: 3px solid #0f172a;
                display: flex;
                align-items: center;
                justify-content: center;
                color: #0f172a;
                font-weight: bold;
                font-family: 'Outfit', sans-serif;
                box-shadow: 0 4px 10px rgba(0,0,0,0.5);
            ">${index + 1}</div>`,
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        });

        // Build activities HTML
        let activitiesHTML = '';
        if (loc.activities.allDay) {
            activitiesHTML += `<p style="margin: 5px 0;"><strong>🌞 All Day:</strong> ${loc.activities.allDay}</p>`;
        }
        if (loc.activities.morning) {
            activitiesHTML += `<p style="margin: 5px 0;"><strong>🌅 Morning:</strong> ${loc.activities.morning}</p>`;
        }
        if (loc.activities.afternoon) {
            activitiesHTML += `<p style="margin: 5px 0;"><strong>🌇 Afternoon:</strong> ${loc.activities.afternoon}</p>`;
        }
        if (!activitiesHTML) {
            activitiesHTML = '<p style="margin: 5px 0; color: #888;">No activities set</p>';
        }

        const marker = L.marker([loc.lat, loc.lng], { icon: customIcon })
            .addTo(map)
            .bindPopup(`
                <div style="font-family: 'Outfit', sans-serif; color: #0f172a; min-width: 200px;">
                    <h3 style="margin: 0 0 10px 0; color: #00d2ff; text-align: center;">${loc.name}</h3>
                    ${activitiesHTML}
                </div>
            `);

        markers.push(marker);
    });

    // Draw Polyline
    if (locations.length > 1) {
        const latlngs = locations.map(loc => [loc.lat, loc.lng]);
        // Black lines for light mode (NatGeo map), Cyan for dark mode
        const lineColor = currentTheme === 'light' ? '#000000' : '#00d2ff';

        polyline = L.polyline(latlngs, {
            color: lineColor,
            weight: 3,
            opacity: 0.7,
            dashArray: '10, 10',
            lineCap: 'round'
        }).addTo(map);

        // Add travel time labels at midpoints
        for (let i = 0; i < locations.length - 1; i++) {
            const currentLoc = locations[i];
            const nextLoc = locations[i + 1];

            // Determine travel time to display
            let displayTime = nextLoc.travelTime && nextLoc.travelTime.trim() !== ''
                ? nextLoc.travelTime
                : '';

            // If no manual time and we have a mode, estimate it
            if (!displayTime && nextLoc.travelMode) {
                const distance = calculateDistance(
                    currentLoc.lat, currentLoc.lng,
                    nextLoc.lat, nextLoc.lng
                );
                displayTime = estimateTravelTime(distance, nextLoc.travelMode);
            }

            // Only add label if we have time to display
            if (displayTime) {
                // Calculate midpoint between two markers
                const midLat = (currentLoc.lat + nextLoc.lat) / 2;
                const midLng = (currentLoc.lng + nextLoc.lng) / 2;

                // Create custom icon for travel time label
                // Use black text for light mode, white for dark mode
                const textColor = currentTheme === 'light' ? '#000000' : '#f8fafc';

                // Get travel mode icon
                const modeIcons = {
                    'walking': '<i class="fa-solid fa-person-walking" style="margin-right: 4px;"></i>',
                    'biking': '<i class="fa-solid fa-person-biking" style="margin-right: 4px;"></i>',
                    'car': '<i class="fa-solid fa-car" style="margin-right: 4px;"></i>',
                    'boat': '<i class="fa-solid fa-sailboat" style="margin-right: 4px;"></i>',
                    'plane': '<i class="fa-solid fa-plane" style="margin-right: 4px;"></i>'
                };
                const modeIcon = nextLoc.travelMode && modeIcons[nextLoc.travelMode] ? modeIcons[nextLoc.travelMode] : '';

                const travelTimeIcon = L.divIcon({
                    className: 'map-travel-time',
                    html: `<div style="text-align: center; color: ${textColor};">${modeIcon}${displayTime}</div>`,
                    iconSize: null,
                    iconAnchor: null
                });

                // Add invisible marker with the travel time label
                const travelTimeMarker = L.marker([midLat, midLng], {
                    icon: travelTimeIcon,
                    interactive: false
                }).addTo(map);

                travelTimeMarkers.push(travelTimeMarker);
            }
        }
    }
}

// Render Itinerary List
function renderItineraryList() {
    itineraryList.innerHTML = '';

    if (locations.length === 0) {
        itineraryList.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-map-location-dot"></i>
                <p>Start your journey by clicking on the map!</p>
            </div>
        `;
        return;
    }

    locations.forEach((loc, index) => {
        const card = document.createElement('div');
        card.className = 'location-card';
        card.dataset.id = loc.id;

        // Default image if none provided
        const bgImage = loc.imageUrl || 'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80';

        // Activity Summary - show all activities
        let activitySummary = '';
        if (loc.activities.allDay) {
            activitySummary += `<div class="detail-row"><i class="fa-solid fa-calendar-day"></i> <span>${loc.activities.allDay}</span></div>`;
        }
        if (loc.activities.morning) {
            activitySummary += `<div class="detail-row"><i class="fa-solid fa-sun"></i> <span>${loc.activities.morning}</span></div>`;
        }
        if (loc.activities.afternoon) {
            activitySummary += `<div class="detail-row"><i class="fa-solid fa-cloud-sun"></i> <span>${loc.activities.afternoon}</span></div>`;
        }

        card.innerHTML = `
            <div class="card-image" style="background-image: url('${bgImage}')">
                <div class="card-header-overlay">
                    <div class="card-number">${index + 1}</div>
                    <h3 class="card-title">${loc.name}</h3>
                </div>
                <div class="card-weather" id="weather-${loc.id}">
                    <i class="fa-solid fa-spinner fa-spin"></i>
                </div>
                <div class="card-actions">
                    <button class="card-action-btn edit" onclick="event.stopPropagation(); editLocation('${loc.id}')" title="Edit">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button class="card-action-btn delete" onclick="event.stopPropagation(); deleteLocation('${loc.id}')" title="Delete">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>
            <div class="card-content">
                <div class="card-meta">
                    ${loc.travelTime ? `<div class="meta-item"><i class="fa-solid fa-clock"></i> ${loc.travelTime}</div>` : ''}
                    ${loc.placeToStay ? `<div class="meta-item"><i class="fa-solid fa-bed"></i> ${loc.placeToStay}</div>` : ''}
                </div>
                <div class="card-details">
                    ${activitySummary}
                    ${loc.kidsActivity ? `<div class="detail-row"><i class="fa-solid fa-child-reaching"></i> <span>Kids: ${loc.kidsActivity}</span></div>` : ''}
                    ${loc.foodOptions ? `<div class="detail-row"><i class="fa-solid fa-utensils"></i> <span>Food: ${loc.foodOptions}</span></div>` : ''}
                    ${loc.funFact ? `<div class="fun-fact"><i class="fa-solid fa-lightbulb" style="color: #ff0055; margin-right: 5px;"></i> ${loc.funFact}</div>` : ''}
                </div>
            </div>
        `;

        // Fetch weather
        fetchWeather(loc.lat, loc.lng, `weather-${loc.id}`);

        // Add click handler to toggle expanded state and center map
        card.addEventListener('click', function (e) {
            // Don't toggle if clicking on action buttons
            if (e.target.closest('.card-action-btn')) return;
            this.classList.toggle('expanded');

            // Center map on this location
            map.setView([loc.lat, loc.lng], 10, {
                animate: true,
                duration: 0.5
            });
        });

        itineraryList.appendChild(card);
    });
}

// Drag and Drop Logic
function setupDragAndDrop() {
    new Sortable(itineraryList, {
        animation: 150,
        ghostClass: 'sortable-ghost',
        dragClass: 'sortable-drag',
        handle: '.location-card', // Make whole card draggable
        onEnd: function (evt) {
            const itemEl = evt.item;
            const newIndex = evt.newIndex;
            const oldIndex = evt.oldIndex;

            // Update State
            const movedItem = locations.splice(oldIndex, 1)[0];
            locations.splice(newIndex, 0, movedItem);

            // Re-render to update numbers and map
            renderApp();
            saveData();
        }
    });
}

// Modal & Form Logic
function openModal(editId = null) {
    locationModal.classList.add('active');

    // Tab Logic
    const tabs = document.querySelectorAll('.tab');
    const contents = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            contents.forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(`${tab.dataset.tab}-content`).classList.add('active');
        });
    });

    // Travel Mode Selector Logic - Reset active state
    const modeButtons = document.querySelectorAll('.travel-mode-btn');
    modeButtons.forEach(btn => btn.classList.remove('active'));

    if (editId) {
        // Edit Mode
        const loc = locations.find(l => l.id === editId);
        document.getElementById('modalTitle').innerText = 'Edit Location';
        document.getElementById('locationId').value = loc.id;
        document.getElementById('locationLat').value = loc.lat;
        document.getElementById('locationLng').value = loc.lng;
        document.getElementById('locationName').value = loc.name;
        document.getElementById('imageUrl').value = loc.imageUrl;
        document.getElementById('travelTime').value = loc.travelTime;
        const mode = loc.travelMode || '';
        document.getElementById('travelMode').value = mode;

        // Set active button
        if (mode) {
            const activeBtn = document.querySelector(`.travel-mode-btn[data-mode="${mode}"]`);
            if (activeBtn) activeBtn.classList.add('active');
        }
        document.getElementById('placeToStay').value = loc.placeToStay;
        document.getElementById('morningActivity').value = loc.activities.morning;
        document.getElementById('afternoonActivity').value = loc.activities.afternoon;
        document.getElementById('allDayActivity').value = loc.activities.allDay;
        document.getElementById('kidsActivity').value = loc.kidsActivity;
        document.getElementById('foodOptions').value = loc.foodOptions;
        document.getElementById('funFact').value = loc.funFact;
    } else {
        // Add Mode
        document.getElementById('modalTitle').innerText = 'Add Location';
        locationForm.reset();
        document.getElementById('locationId').value = '';
        if (tempClickCoords) {
            document.getElementById('locationLat').value = tempClickCoords.lat;
            document.getElementById('locationLng').value = tempClickCoords.lng;
        }
    }
}

function closeModal() {
    locationModal.classList.remove('active');
    tempClickCoords = null;
}

// Event Listeners
function setupEventListeners() {
    // Modal Close Buttons
    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.addEventListener('click', closeModal);
    });

    // Form Submit
    locationForm.addEventListener('submit', (e) => {
        e.preventDefault();

        const id = document.getElementById('locationId').value || Date.now().toString();
        const newLocation = {
            id: id,
            lat: parseFloat(document.getElementById('locationLat').value),
            lng: parseFloat(document.getElementById('locationLng').value),
            name: document.getElementById('locationName').value,
            imageUrl: document.getElementById('imageUrl').value,
            travelTime: document.getElementById('travelTime').value,
            travelMode: document.getElementById('travelMode').value,
            placeToStay: document.getElementById('placeToStay').value,
            activities: {
                morning: document.getElementById('morningActivity').value,
                afternoon: document.getElementById('afternoonActivity').value,
                allDay: document.getElementById('allDayActivity').value
            },
            kidsActivity: document.getElementById('kidsActivity').value,
            foodOptions: document.getElementById('foodOptions').value,
            funFact: document.getElementById('funFact').value
        };

        const existingIndex = locations.findIndex(l => l.id === id);
        if (existingIndex > -1) {
            locations[existingIndex] = newLocation;
        } else {
            locations.push(newLocation);
        }

        closeModal();
        renderApp();
        saveData();
    });

    // Reset Button
    resetBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear your itinerary?')) {
            locations = [];
            renderApp();
            saveData();
        }
    });

    // Info Modal
    const infoBtn = document.getElementById('infoBtn');
    const infoModal = document.getElementById('infoModal');
    const closeInfoModal = document.getElementById('closeInfoModal');

    if (infoBtn && infoModal && closeInfoModal) {
        infoBtn.addEventListener('click', () => {
            infoModal.classList.add('active');
        });

        closeInfoModal.addEventListener('click', () => {
            infoModal.classList.remove('active');
        });

        // Close info modal when clicking outside
        infoModal.addEventListener('click', (e) => {
            if (e.target === infoModal) {
                infoModal.classList.remove('active');
            }
        });
    }

    // Theme Toggle Button
    themeToggleBtn.addEventListener('click', toggleTheme);

    // Export Button
    document.getElementById('exportBtn').addEventListener('click', exportItinerary);

    // Import Button
    const fileInput = document.getElementById('importFile');
    document.getElementById('importBtn').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', importItinerary);

    // Event Delegation for Edit/Delete buttons in Itinerary List
    itineraryList.addEventListener('click', (e) => {
        const btn = e.target.closest('.card-action-btn');
        if (!btn) return;

        const card = btn.closest('.location-card');
        const id = card.dataset.id;

        if (btn.classList.contains('edit')) {
            editLocation(id);
        } else if (btn.classList.contains('delete')) {
            deleteLocation(id);
        }
    });

    // Travel Mode Selector Buttons
    const modeButtons = document.querySelectorAll('.travel-mode-btn');
    const travelModeInput = document.getElementById('travelMode');

    modeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            modeButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            travelModeInput.value = btn.dataset.mode;
        });
    });
}

// Helper Functions
function editLocation(id) {
    openModal(id);
}

function deleteLocation(id) {
    if (confirm('Delete this location?')) {
        locations = locations.filter(l => l.id !== id);
        renderApp();
        saveData();
    }
}

function updateStats() {
    locationCount.innerText = `${locations.length} Stop${locations.length !== 1 ? 's' : ''}`;
}

function saveData() {
    localStorage.setItem('travel_planner_locations', JSON.stringify(locations));
}

// Weather Functions
async function fetchWeather(lat, lng, elementId) {
    try {
        const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true`);
        const data = await response.json();

        if (data.current_weather) {
            const temp = Math.round(data.current_weather.temperature);
            const code = data.current_weather.weathercode;
            const iconClass = getWeatherIcon(code);

            const weatherEl = document.getElementById(elementId);
            if (weatherEl) {
                weatherEl.innerHTML = `<i class="${iconClass}"></i> ${temp}°C`;
            }
        }
    } catch (error) {
        console.error('Error fetching weather:', error);
        const weatherEl = document.getElementById(elementId);
        if (weatherEl) {
            weatherEl.style.display = 'none';
        }
    }
}

function getWeatherIcon(code) {
    // WMO Weather interpretation codes (WW)
    // 0: Clear sky
    if (code === 0) return 'fa-solid fa-sun';
    // 1, 2, 3: Mainly clear, partly cloudy, and overcast
    if ([1, 2, 3].includes(code)) return 'fa-solid fa-cloud-sun';
    // 45, 48: Fog
    if ([45, 48].includes(code)) return 'fa-solid fa-smog';
    // 51, 53, 55: Drizzle
    if ([51, 53, 55].includes(code)) return 'fa-solid fa-cloud-rain';
    // 61, 63, 65: Rain
    if ([61, 63, 65].includes(code)) return 'fa-solid fa-cloud-showers-heavy';
    // 71, 73, 75: Snow fall
    if ([71, 73, 75].includes(code)) return 'fa-solid fa-snowflake';
    // 80, 81, 82: Rain showers
    if ([80, 81, 82].includes(code)) return 'fa-solid fa-cloud-showers-water';
    // 95, 96, 99: Thunderstorm
    if ([95, 96, 99].includes(code)) return 'fa-solid fa-bolt';

    return 'fa-solid fa-cloud';
}

// Export/Import Functions
function exportItinerary() {
    const geoJSON = {
        type: "FeatureCollection",
        features: locations.map(loc => ({
            type: "Feature",
            geometry: {
                type: "Point",
                coordinates: [loc.lng, loc.lat]
            },
            properties: {
                id: loc.id,
                name: loc.name,
                imageUrl: loc.imageUrl,
                travelTime: loc.travelTime,
                placeToStay: loc.placeToStay,
                activities: loc.activities,
                kidsActivity: loc.kidsActivity,
                foodOptions: loc.foodOptions,
                funFact: loc.funFact
            }
        }))
    };

    const dataStr = JSON.stringify(geoJSON, null, 2);
    const blob = new Blob([dataStr], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'travel_planner_itinerary.geojson';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function importItinerary(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const importedData = JSON.parse(e.target.result);

            // Check if it's a valid GeoJSON FeatureCollection
            if (importedData.type === "FeatureCollection" && Array.isArray(importedData.features)) {
                if (confirm('Importing will replace your current itinerary. Continue?')) {
                    locations = importedData.features.map(feature => {
                        const props = feature.properties;
                        const coords = feature.geometry.coordinates; // [lng, lat]

                        return {
                            id: props.id || Date.now().toString() + Math.random(),
                            lat: coords[1],
                            lng: coords[0],
                            name: props.name || "Unnamed Location",
                            imageUrl: props.imageUrl || "",
                            travelTime: props.travelTime || "",
                            placeToStay: props.placeToStay || "",
                            activities: props.activities || { morning: "", afternoon: "", allDay: "" },
                            kidsActivity: props.kidsActivity || "",
                            foodOptions: props.foodOptions || "",
                            funFact: props.funFact || ""
                        };
                    });

                    renderApp();
                    saveData();
                    alert('Itinerary imported successfully from GeoJSON!');
                }
            } else if (Array.isArray(importedData)) {
                // Backward compatibility for old JSON array format
                if (confirm('Legacy format detected. Importing will replace your current itinerary. Continue?')) {
                    locations = importedData;
                    renderApp();
                    saveData();
                    alert('Itinerary imported successfully!');
                }
            } else {
                alert('Invalid file format: Must be a GeoJSON FeatureCollection or a valid JSON array.');
            }
        } catch (error) {
            console.error('Import Error:', error);
            alert('Error importing file. Please make sure it is a valid JSON/GeoJSON file.');
        }
        // Reset input
        event.target.value = '';
    };
    reader.readAsText(file);
}
