console.log('SCRIPT LOADED: script.js');
// State Management
let locations = JSON.parse(localStorage.getItem('travel_planner_locations')) || [];
let map;
let mapTileLayer;
let markers = [];
let travelTimeMarkers = [];
let polyline;
let tempClickCoords = null;
let currentTheme = localStorage.getItem('travel_planner_theme') || 'dark';

// DOM Elements (Initialized in DOMContentLoaded)
let locationModal;
let locationForm;
let locationSearch;
let itineraryList;
let locationCount;
let exportBtn;
let resetBtn;
let fullscreenBtn;
let themeToggleBtn;

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
    console.log('App Initializing...');

    // Initialize DOM Elements
    locationModal = document.getElementById('locationModal');
    locationForm = document.getElementById('locationForm');
    locationSearch = document.getElementById('locationSearch');
    itineraryList = document.getElementById('itineraryList');
    locationCount = document.getElementById('locationCount');
    exportBtn = document.getElementById('exportBtn');
    resetBtn = document.getElementById('resetBtn');
    fullscreenBtn = document.getElementById('fullscreenBtn');
    themeToggleBtn = document.getElementById('themeToggle');

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

    let activeCount = 0;
    const activeLocations = locations.filter(l => !l.disabled);

    // Add Markers
    locations.forEach((loc, index) => {
        let markerContent = '';
        let markerColor = '#00d2ff'; // Default Cyan
        let markerBorder = '#0f172a';
        let zIndex = 1000;

        if (loc.disabled) {
            markerColor = '#64748b'; // Grey for disabled
            markerContent = '<i class="fa-solid fa-eye-slash" style="font-size: 12px;"></i>';
            zIndex = 500;
        } else {
            activeCount++;
            markerContent = activeCount;
        }

        const customIcon = L.divIcon({
            className: 'custom-map-marker',
            html: `<div style="
                background-color: ${markerColor};
                width: 30px;
                height: 30px;
                border-radius: 50%;
                border: 3px solid ${markerBorder};
                display: flex;
                align-items: center;
                justify-content: center;
                color: ${markerBorder};
                font-weight: bold;
                font-family: 'Outfit', sans-serif;
                box-shadow: 0 4px 10px rgba(0,0,0,0.5);
                opacity: ${loc.disabled ? 0.7 : 1};
            ">${markerContent}</div>`,
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

        const marker = L.marker([loc.lat, loc.lng], {
            icon: customIcon,
            zIndexOffset: zIndex
        })
            .addTo(map)
            .bindPopup(`
                <div style="font-family: 'Outfit', sans-serif; color: #0f172a; min-width: 200px;">
                    <h3 style="margin: 0 0 10px 0; color: ${markerColor}; text-align: center;">${loc.name} ${loc.disabled ? '(Disabled)' : ''}</h3>
                    ${activitiesHTML}
                </div>
            `);

        markers.push(marker);
    });

    // Draw Polyline (Only for active locations)
    if (activeLocations.length > 1) {
        const latlngs = activeLocations.map(loc => [loc.lat, loc.lng]);
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
        for (let i = 0; i < activeLocations.length - 1; i++) {
            const currentLoc = activeLocations[i];
            const nextLoc = activeLocations[i + 1];

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

function toggleDisable(id) {
    const locIndex = locations.findIndex(l => l.id === id);
    if (locIndex === -1) return;

    const loc = locations[locIndex];
    loc.disabled = !loc.disabled;

    // Remove from current position
    locations.splice(locIndex, 1);

    if (loc.disabled) {
        // If disabling, move to end of list
        locations.push(loc);
    } else {
        // If enabling, move to end of ACTIVE items (before first disabled item)
        const firstDisabledIndex = locations.findIndex(l => l.disabled);
        if (firstDisabledIndex === -1) {
            locations.push(loc);
        } else {
            locations.splice(firstDisabledIndex, 0, loc);
        }
    }

    renderApp();
    saveData();
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

// Render Itinerary List
function renderItineraryList() {
    itineraryList.innerHTML = '';

    if (locations.length === 0) {
        itineraryList.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-map-location-dot"></i>
                <p>No locations added yet. Click on the map to start planning!</p>
            </div>
        `;
        return;
    }

    let activeCount = 0;

    locations.forEach((loc, index) => {
        const card = document.createElement('div');
        card.className = `location-card ${loc.disabled ? 'disabled' : ''}`;
        card.dataset.id = loc.id;

        // Calculate number only for active items
        let displayNumber = '';
        if (!loc.disabled) {
            activeCount++;
            displayNumber = activeCount;
        }

        const bgImage = loc.imageUrl || 'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?ixlib=rb-4.0.3&auto=format&fit=crop&w=1350&q=80';

        // Build activities HTML
        let activitiesHTML = '';
        if (loc.activities) {
            if (loc.activities.allDay) {
                activitiesHTML += `<div class="detail-row"><i class="fa-solid fa-calendar-day"></i> <span><strong>All Day:</strong> ${loc.activities.allDay}</span></div>`;
            }
            if (loc.activities.morning) {
                activitiesHTML += `<div class="detail-row"><i class="fa-solid fa-sun"></i> <span><strong>Morning:</strong> ${loc.activities.morning}</span></div>`;
            }
            if (loc.activities.afternoon) {
                activitiesHTML += `<div class="detail-row"><i class="fa-solid fa-cloud-sun"></i> <span><strong>Afternoon:</strong> ${loc.activities.afternoon}</span></div>`;
            }
        }

        card.innerHTML = `
            <div class="card-image" style="background-image: url('${bgImage}')">
                <div class="card-header-overlay">
                    ${!loc.disabled ? `<div class="card-number">${displayNumber}</div>` : ''}
                    <h3 class="card-title">${loc.name}</h3>
                </div>
                <div class="card-weather" id="weather-${loc.id}">
                    <i class="fa-solid fa-spinner fa-spin"></i>
                </div>
                <div class="card-actions">
                    <button class="card-action-btn disable" onclick="event.stopPropagation(); toggleDisable('${loc.id}')" title="${loc.disabled ? 'Enable' : 'Disable'}">
                        <i class="fa-solid ${loc.disabled ? 'fa-eye' : 'fa-eye-slash'}"></i>
                    </button>
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
                    ${activitiesHTML}
                    ${loc.kidsActivity ? `<div class="detail-row"><i class="fa-solid fa-child-reaching"></i> <span>Kids: ${loc.kidsActivity}</span></div>` : ''}
                    ${loc.foodOptions ? `<div class="detail-row"><i class="fa-solid fa-utensils"></i> <span>Food: ${loc.foodOptions}</span></div>` : ''}
                    ${loc.funFact ? `<div class="fun-fact"><i class="fa-solid fa-lightbulb" style="color: #ffaa00; margin-right: 5px;"></i> ${loc.funFact}</div>` : ''}
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
                delayOnTouchOnly: true,
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
        });

        itineraryList.appendChild(card);
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
        if (locationSearch) locationSearch.value = ''; // Clear search
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

// Drag and Drop Logic
function setupDragAndDrop() {
    console.log('setupDragAndDrop called');
    const el = document.getElementById('itineraryList');
    if (!el) {
        console.error('itineraryList not found');
        return;
    }

    if (typeof Sortable !== 'undefined') {
        console.log('SortableJS found, creating instance');
        Sortable.create(el, {
            animation: 150,
            delay: 150, // Add delay to prevent accidental drags
            delayOnTouchOnly: true, // Only delay on touch devices
            filter: '.card-action-btn', // Prevent dragging from buttons
            preventOnFilter: false, // Allow clicks on filtered elements
            onEnd: function (evt) {
                console.log('Drag ended', evt);
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
    } else {
        console.warn('SortableJS not loaded');
    }
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
    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', toggleTheme);
    }

    // Fullscreen Button
    if (fullscreenBtn) {
        fullscreenBtn.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(err => {
                    console.error(`Fullscreen error: ${err.message}`);
                });
            } else {
                if (document.exitFullscreen) {
                    document.exitFullscreen();
                }
            }
        });

        // Update icon when fullscreen state changes
        document.addEventListener('fullscreenchange', () => {
            const icon = fullscreenBtn.querySelector('i');
            if (document.fullscreenElement) {
                icon.classList.remove('fa-expand');
                icon.classList.add('fa-compress');
                fullscreenBtn.title = "Exit Full Screen";
            } else {
                icon.classList.remove('fa-compress');
                icon.classList.add('fa-expand');
                fullscreenBtn.title = "Toggle Full Screen";
            }
        });
    }

    // Export Button
    if (printBtn) {
        printBtn.addEventListener('click', () => window.print());
    }

    if (exportBtn) {
        exportBtn.addEventListener('click', exportItinerary);
    } else {
        const dynamicExportBtn = document.getElementById('exportBtn');
        if (dynamicExportBtn) dynamicExportBtn.addEventListener('click', exportItinerary);
    }

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

    // Location Search Listener
    if (locationSearch) {
        locationSearch.addEventListener('input', debounce((e) => {
            const query = e.target.value.trim();
            if (query.length > 2) {
                searchLocation(query);
            }
        }, 1500));
    }
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

// Location Search Functions
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

async function searchLocation(query) {
    try {
        // Show loading state (optional, could add a spinner icon change here)
        const searchIcon = locationSearch.nextElementSibling;
        if (searchIcon) searchIcon.className = 'fa-solid fa-spinner fa-spin';

        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
        const data = await response.json();

        // Reset icon
        if (searchIcon) searchIcon.className = 'fa-solid fa-magnifying-glass';

        if (data && data.length > 0) {
            const result = data[0];
            document.getElementById('locationLat').value = parseFloat(result.lat).toFixed(4);
            document.getElementById('locationLng').value = parseFloat(result.lon).toFixed(4);

            // Optional: Update name if empty
            const nameInput = document.getElementById('locationName');
            if (!nameInput.value) {
                // Try to get a good name from the result
                // display_name is often very long, so maybe just use the query or first part
                nameInput.value = result.name || query;
            }
        }
    } catch (error) {
        console.error('Error searching location:', error);
        const searchIcon = locationSearch.nextElementSibling;
        if (searchIcon) searchIcon.className = 'fa-solid fa-triangle-exclamation';
    }
}

// Export/Import Functions
function exportItinerary() {
    // Create KML XML structure
    let kml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    kml += '<kml xmlns="http://www.opengis.net/kml/2.2">\n';
    kml += '  <Document>\n';
    kml += '    <name>Travel Planner Itinerary</name>\n';
    kml += '    <description>Exported from Travel Planner</description>\n';

    locations.forEach((loc, index) => {
        kml += '    <Placemark>\n';
        kml += `      <name>${escapeXml(loc.name)}</name>\n`;
        kml += `      <description>${escapeXml(loc.funFact || 'No description')}</description>\n`;
        kml += '      <Point>\n';
        kml += `        <coordinates>${loc.lng},${loc.lat},0</coordinates>\n`;
        kml += '      </Point>\n';
        kml += '      <ExtendedData>\n';
        kml += `        <Data name="id"><value>${escapeXml(loc.id)}</value></Data>\n`;
        kml += `        <Data name="imageUrl"><value>${escapeXml(loc.imageUrl || '')}</value></Data>\n`;
        kml += `        <Data name="travelTime"><value>${escapeXml(loc.travelTime || '')}</value></Data>\n`;
        kml += `        <Data name="travelMode"><value>${escapeXml(loc.travelMode || '')}</value></Data>\n`;
        kml += `        <Data name="placeToStay"><value>${escapeXml(loc.placeToStay || '')}</value></Data>\n`;
        kml += `        <Data name="morningActivity"><value>${escapeXml(loc.activities?.morning || '')}</value></Data>\n`;
        kml += `        <Data name="afternoonActivity"><value>${escapeXml(loc.activities?.afternoon || '')}</value></Data>\n`;
        kml += `        <Data name="allDayActivity"><value>${escapeXml(loc.activities?.allDay || '')}</value></Data>\n`;
        kml += `        <Data name="kidsActivity"><value>${escapeXml(loc.kidsActivity || '')}</value></Data>\n`;
        kml += `        <Data name="foodOptions"><value>${escapeXml(loc.foodOptions || '')}</value></Data>\n`;
        kml += `        <Data name="funFact"><value>${escapeXml(loc.funFact || '')}</value></Data>\n`;
        kml += `        <Data name="disabled"><value>${loc.disabled || false}</value></Data>\n`;
        kml += '      </ExtendedData>\n';
        kml += '    </Placemark>\n';
    });

    kml += '  </Document>\n';
    kml += '</kml>';

    const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'travel_planner_itinerary.kml';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Helper function to escape XML special characters
function escapeXml(unsafe) {
    if (typeof unsafe !== 'string') return '';
    return unsafe.replace(/[<>&'"]/g, (c) => {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
            default: return c;
        }
    });
}

function importItinerary(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const kmlText = e.target.result;
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(kmlText, 'text/xml');

            // Check for parsing errors
            const parserError = xmlDoc.querySelector('parsererror');
            if (parserError) {
                throw new Error('Invalid XML format');
            }

            // Get all Placemark elements
            const placemarks = xmlDoc.querySelectorAll('Placemark');

            if (placemarks.length === 0) {
                alert('No locations found in KML file.');
                event.target.value = '';
                return;
            }

            if (confirm('Importing will replace your current itinerary. Continue?')) {
                locations = Array.from(placemarks).map(placemark => {
                    // Extract coordinates
                    const coordsText = placemark.querySelector('coordinates')?.textContent.trim();
                    const coords = coordsText ? coordsText.split(',') : [0, 0, 0];
                    const lng = parseFloat(coords[0]) || 0;
                    const lat = parseFloat(coords[1]) || 0;

                    // Extract name
                    const name = placemark.querySelector('name')?.textContent || 'Unnamed Location';

                    // Extract extended data
                    const getData = (name) => {
                        const dataEl = placemark.querySelector(`Data[name="${name}"] value`);
                        return dataEl?.textContent || '';
                    };

                    return {
                        id: getData('id') || Date.now().toString() + Math.random(),
                        lat: lat,
                        lng: lng,
                        name: name,
                        imageUrl: getData('imageUrl'),
                        travelTime: getData('travelTime'),
                        travelMode: getData('travelMode'),
                        placeToStay: getData('placeToStay'),
                        activities: {
                            morning: getData('morningActivity'),
                            afternoon: getData('afternoonActivity'),
                            allDay: getData('allDayActivity')
                        },
                        kidsActivity: getData('kidsActivity'),
                        foodOptions: getData('foodOptions'),
                        funFact: getData('funFact'),
                        disabled: getData('disabled') === 'true'
                    };
                });

                renderApp();
                saveData();
                alert('Itinerary imported successfully from KML!');
            }
        } catch (error) {
            console.error('Import Error:', error);
            alert('Error importing file. Please make sure it is a valid KML file.');
        }
        // Reset input
        event.target.value = '';
    };
    reader.readAsText(file);
}
