console.log('SCRIPT LOADED: script.js');
// State Management
let locations = JSON.parse(localStorage.getItem('travel_planner_locations')) || [];
let showRestaurants = localStorage.getItem('travel_planner_show_restaurants') !== 'false'; // Default true
let showSupermarkets = false; // Default false (heavy load)
let map;
let mapTileLayer;
let markers = [];
let restaurantMarkers = [];
let supermarketMarkers = [];
let travelTimeMarkers = [];
let polyline;
let tempClickCoords = null;
let currentTheme = localStorage.getItem('travel_planner_theme') || 'dark';
let globeView = localStorage.getItem('travel_planner_globe_view') === 'true';
let globeInstance = null;
let isGlobeActive = false;
let groupingEnabled = localStorage.getItem('travel_planner_grouping_enabled') === 'true';
let collapsedGroups = JSON.parse(localStorage.getItem('travel_planner_collapsed_groups')) || [];
let isTransitioning = false;
let restaurants = JSON.parse(localStorage.getItem('travel_planner_restaurants')) || [];

// Linked File State
let autoSync = localStorage.getItem('travel_planner_auto_sync') !== 'false';
let kmlFileHandle = null;
let csvFileHandle = null;

// Network Sync State (WebDAV)
let syncEnabled = localStorage.getItem('travel_planner_sync_enabled') === 'true';
let syncUrl = localStorage.getItem('travel_planner_sync_url') || '';
let kmlFileName = localStorage.getItem('travel_planner_kml_filename') || 'travel_planner_itinerary.kml';
let csvFileName = localStorage.getItem('travel_planner_csv_filename') || 'restaurants.csv';
let syncUsername = localStorage.getItem('travel_planner_sync_username') || '';
let syncPassword = localStorage.getItem('travel_planner_sync_password') || '';
let lastSyncTime = localStorage.getItem('travel_planner_last_sync_time') || 'Never';

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
let importRestaurantsBtn;
let importRestaurantsFile;

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
    resetBtn = document.getElementById('resetBtn'); // Keep for safety or remove if unused in header
    fullscreenBtn = document.getElementById('fullscreenBtn');
    themeToggleBtn = document.getElementById('themeToggle');
    // New Settings Elements
    importRestaurantsFile = document.getElementById('importRestaurantsFile');
    importFile = document.getElementById('importFile');

    initMap();
    renderApp();
    setupEventListeners();
    setupDragAndDrop();

    // Load persisted restaurants
    if (restaurants.length > 0) {
        console.log(`Loading ${restaurants.length} persisted restaurants...`);
        restaurants.forEach(r => addRestaurantMarker(r));
    }

    // Try to restore linked files from IndexedDB
    restoreLinkedFiles();

    // Apply persisted states
    if (globeView) toggleGlobeView(true);
    const groupingToggle = document.getElementById('toggleGrouping');
    if (groupingToggle) {
        groupingToggle.checked = groupingEnabled;
        groupingToggle.addEventListener('change', (e) => {
            groupingEnabled = e.target.checked;
            localStorage.setItem('travel_planner_grouping_enabled', groupingEnabled);
            updateSortableState();
            renderApp();
        });
    }
});

// Map Initialization
function initMap() {
    // Default view (Europe)
    map = L.map('map', {
        dragging: !L.Browser.mobile,
        zoomSnap: 0.1,
        zoomDelta: 0.5,
        wheelPxPerZoomLevel: 120
    }).setView([48.8566, 2.3522], 5);

    // Initialize with current theme
    setMapTheme(currentTheme);
    updateThemeIcon();

    // Map Click Handler
    map.on('click', (e) => {
        tempClickCoords = e.latlng;
        openModal();
    });

    // Auto-switch to globe when user zooms out to world scale on flat map
    map.on('zoomend', () => {
        if (globeView && !isGlobeActive && !isTransitioning && map.getZoom() < 4) {
            const center = map.getCenter().wrap(); // Ensure lng stays in [-180, 180]
            const targetAlt = zoomToAltitude(map.getZoom());
            executeViewSwap(true, { lat: center.lat, lng: center.lng, altitude: targetAlt });
        }
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
    
    document.body.classList.toggle('dark-map-theme', theme === 'dark');
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
    updateGlobeData(); // Keep 3D globe in sync if active
    updateTagSuggestions();
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
        'train': 80,
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

// Day Trip Helper Functions
function toggleDayTripLines(locId, showLines) {
    const loc = locations.find(l => l.id === locId);
    if (loc) {
        loc.hideDayTripLines = !showLines;
        renderMapElements();
        saveData();
    }
}

function toggleNextLine(locId, showLine) {
    const loc = locations.find(l => l.id === locId);
    if (loc) {
        loc.hideNextLine = !showLine;
        renderMapElements();
        saveData();
    }
}
function addDayTrip(parentId, editTripId = null) {
    const loc = locations.find(l => l.id === parentId);
    if (!loc) return;

    // Find the form container within the card
    const card = document.querySelector(`[data-id="${parentId}"]`);
    if (!card) return;

    const section = card.querySelector('.day-trips-section');
    if (!section) return;

    // Remove existing form if any
    const existingForm = section.querySelector('.day-trip-form');
    if (existingForm) {
        existingForm.remove();
        // If we clicked the same Add/Edit button, just toggle off
        if (existingForm.dataset.mode === (editTripId ? 'edit' : 'add')) return;
    }

    let editTrip = null;
    if (editTripId && loc.dayTrips) {
        editTrip = loc.dayTrips.find(t => t.id === editTripId);
    }

    const form = document.createElement('div');
    form.className = 'day-trip-form';
    form.dataset.mode = editTrip ? 'edit' : 'add';
    form.innerHTML = `
        <div style="position: relative;">
            <input type="text" class="dt-search" placeholder="Search location...">
            <i class="fa-solid fa-magnifying-glass" style="position: absolute; right: 8px; top: 50%; transform: translateY(-50%); color: #64748b; font-size: 0.75rem;"></i>
        </div>
        <input type="text" class="dt-name" placeholder="Name (e.g., Mostar)">
        <div class="form-row">
            <input type="number" class="dt-lat" step="any" placeholder="Latitude">
            <input type="number" class="dt-lng" step="any" placeholder="Longitude">
        </div>
        <textarea class="dt-notes" rows="2" placeholder="Notes (optional)"></textarea>
        <div class="day-trip-form-actions">
            <button type="button" class="cancel-trip-btn">Cancel</button>
            <button type="button" class="save-trip-btn"><i class="fa-solid fa-plus"></i> Add</button>
        </div>
    `;

    section.appendChild(form);

    // Stop click propagation on entire form
    form.addEventListener('click', e => e.stopPropagation());

    // Search handler
    const searchInput = form.querySelector('.dt-search');
    const nameInput = form.querySelector('.dt-name');
    const latInput = form.querySelector('.dt-lat');
    const lngInput = form.querySelector('.dt-lng');
    const searchIcon = form.querySelector('.fa-magnifying-glass');

    searchInput.addEventListener('input', debounce(async (e) => {
        const query = e.target.value.trim();
        if (query.length < 3) return;

        if (searchIcon) searchIcon.className = 'fa-solid fa-spinner fa-spin';
        try {
            const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
            const data = await response.json();
            if (searchIcon) searchIcon.className = 'fa-solid fa-magnifying-glass';
            if (data && data.length > 0) {
                const result = data[0];
                latInput.value = parseFloat(result.lat).toFixed(4);
                lngInput.value = parseFloat(result.lon).toFixed(4);
                if (!nameInput.value) {
                    nameInput.value = result.name || query;
                }
            }
        } catch (err) {
            if (searchIcon) searchIcon.className = 'fa-solid fa-triangle-exclamation';
        }
    }, 1200));

    if (editTrip) {
        nameInput.value = editTrip.name;
        latInput.value = editTrip.lat;
        lngInput.value = editTrip.lng;
        form.querySelector('.dt-notes').value = editTrip.notes || '';
        form.querySelector('.save-trip-btn').innerHTML = '<i class="fa-solid fa-save"></i> Save';
    }

    // Cancel
    form.querySelector('.cancel-trip-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        form.remove();
    });

    // Save
    form.querySelector('.save-trip-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        const name = nameInput.value.trim();
        const lat = parseFloat(latInput.value);
        const lng = parseFloat(lngInput.value);
        const notes = form.querySelector('.dt-notes').value.trim();

        if (!name || isNaN(lat) || isNaN(lng)) {
            alert('Please provide a name and valid coordinates (use search to auto-fill).');
            return;
        }

        if (editTrip) {
            editTrip.name = name;
            editTrip.lat = lat;
            editTrip.lng = lng;
            editTrip.notes = notes;
        } else {
            if (!loc.dayTrips) loc.dayTrips = [];
            loc.dayTrips.push({
                id: 'dt_' + Date.now().toString(),
                name: name,
                lat: lat,
                lng: lng,
                notes: notes
            });
        }

        renderApp();
        saveData();
    });

    // Focus search input
    setTimeout(() => searchInput.focus(), 50);
}

function removeDayTrip(parentId, tripId) {
    const loc = locations.find(l => l.id === parentId);
    if (!loc || !loc.dayTrips) return;
    loc.dayTrips = loc.dayTrips.filter(t => t.id !== tripId);
    renderApp();
    saveData();
}

function moveDayTrip(parentId, tripId, direction) {
    const loc = locations.find(l => l.id === parentId);
    if (!loc || !loc.dayTrips) return;
    const idx = loc.dayTrips.findIndex(t => t.id === tripId);
    if (idx === -1) return;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= loc.dayTrips.length) return;
    const temp = loc.dayTrips[idx];
    loc.dayTrips[idx] = loc.dayTrips[targetIdx];
    loc.dayTrips[targetIdx] = temp;
    renderApp();
    saveData();
}

// Modal Day Trip State & Functions
let modalDayTrips = [];

function renderModalDayTrips() {
    const list = document.getElementById('modalDayTripsList');
    if (!list) return;
    list.innerHTML = '';
    modalDayTrips.forEach((trip, ti) => {
        const subNum = String(ti + 1).padStart(2, '0');
        const item = document.createElement('div');
        item.className = 'day-trip-item';
        item.innerHTML = `
            <div class="day-trip-number">${subNum}</div>
            <div class="day-trip-info">
                <div class="day-trip-name">${trip.name}</div>
                ${trip.notes ? `<div class="day-trip-notes">${trip.notes}</div>` : ''}
            </div>
            <div class="day-trip-actions" style="opacity:1;">
                <button type="button" class="day-trip-action-btn edit" title="Edit"><i class="fa-solid fa-pen"></i></button>
                <button type="button" class="day-trip-action-btn" title="Move Up"><i class="fa-solid fa-chevron-up"></i></button>
                <button type="button" class="day-trip-action-btn" title="Move Down"><i class="fa-solid fa-chevron-down"></i></button>
                <button type="button" class="day-trip-action-btn delete" title="Remove"><i class="fa-solid fa-xmark"></i></button>
            </div>
        `;
        const btns = item.querySelectorAll('.day-trip-action-btn');
        btns[0].addEventListener('click', (e) => { e.stopPropagation(); showModalDayTripForm(ti); });
        btns[1].addEventListener('click', (e) => { e.stopPropagation(); modalMoveDayTrip(ti, 'up'); });
        btns[2].addEventListener('click', (e) => { e.stopPropagation(); modalMoveDayTrip(ti, 'down'); });
        btns[3].addEventListener('click', (e) => { e.stopPropagation(); modalRemoveDayTrip(ti); });
        list.appendChild(item);
    });
}

function modalRemoveDayTrip(index) {
    modalDayTrips.splice(index, 1);
    renderModalDayTrips();
}

function modalMoveDayTrip(index, direction) {
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= modalDayTrips.length) return;
    const temp = modalDayTrips[index];
    modalDayTrips[index] = modalDayTrips[targetIdx];
    modalDayTrips[targetIdx] = temp;
    renderModalDayTrips();
}

function showModalDayTripForm(editIndex = null) {
    const container = document.getElementById('modalDayTripForm');
    if (!container) return;

    // Toggle off if already visible and clicking same action
    if (container.style.display !== 'none') {
        const currentMode = container.dataset.mode;
        const newMode = editIndex !== null ? 'edit' : 'add';
        if (currentMode === newMode) {
            container.style.display = 'none';
            container.innerHTML = '';
            return;
        }
    }

    let editTrip = null;
    if (editIndex !== null && editIndex >= 0 && editIndex < modalDayTrips.length) {
        editTrip = modalDayTrips[editIndex];
    }

    container.dataset.mode = editTrip ? 'edit' : 'add';
    container.style.display = 'block';
    container.innerHTML = `
        <div class="day-trip-form">
            <div style="position: relative;">
                <input type="text" class="dt-search" placeholder="Search location...">
                <i class="fa-solid fa-magnifying-glass" style="position: absolute; right: 8px; top: 50%; transform: translateY(-50%); color: #64748b; font-size: 0.75rem;"></i>
            </div>
            <input type="text" class="dt-name" placeholder="Name (e.g., Mostar)">
            <div class="form-row">
                <input type="number" class="dt-lat" step="any" placeholder="Latitude">
                <input type="number" class="dt-lng" step="any" placeholder="Longitude">
            </div>
            <textarea class="dt-notes" rows="2" placeholder="Notes (optional)"></textarea>
            <div class="day-trip-form-actions">
                <button type="button" class="cancel-trip-btn">Cancel</button>
                <button type="button" class="save-trip-btn"><i class="fa-solid fa-plus"></i> Add</button>
            </div>
        </div>
    `;

    const form = container.querySelector('.day-trip-form');
    const searchInput = form.querySelector('.dt-search');
    const nameInput = form.querySelector('.dt-name');
    const latInput = form.querySelector('.dt-lat');
    const lngInput = form.querySelector('.dt-lng');
    const searchIcon = form.querySelector('.fa-magnifying-glass');

    searchInput.addEventListener('input', debounce(async (e) => {
        const query = e.target.value.trim();
        if (query.length < 3) return;
        if (searchIcon) searchIcon.className = 'fa-solid fa-spinner fa-spin';
        try {
            const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
            const data = await response.json();
            if (searchIcon) searchIcon.className = 'fa-solid fa-magnifying-glass';
            if (data && data.length > 0) {
                const result = data[0];
                latInput.value = parseFloat(result.lat).toFixed(4);
                lngInput.value = parseFloat(result.lon).toFixed(4);
                if (!nameInput.value) {
                    nameInput.value = result.name || query;
                }
            }
        } catch (err) {
            if (searchIcon) searchIcon.className = 'fa-solid fa-triangle-exclamation';
        }
    }, 1200));

    if (editTrip) {
        nameInput.value = editTrip.name;
        latInput.value = editTrip.lat;
        lngInput.value = editTrip.lng;
        form.querySelector('.dt-notes').value = editTrip.notes || '';
        form.querySelector('.save-trip-btn').innerHTML = '<i class="fa-solid fa-save"></i> Save';
    }

    form.querySelector('.cancel-trip-btn').addEventListener('click', () => {
        container.style.display = 'none';
        container.innerHTML = '';
    });

    form.querySelector('.save-trip-btn').addEventListener('click', () => {
        const name = nameInput.value.trim();
        const lat = parseFloat(latInput.value);
        const lng = parseFloat(lngInput.value);
        const notes = form.querySelector('.dt-notes').value.trim();

        if (!name || isNaN(lat) || isNaN(lng)) {
            alert('Please provide a name and valid coordinates (use search to auto-fill).');
            return;
        }

        if (editTrip) {
            editTrip.name = name;
            editTrip.lat = lat;
            editTrip.lng = lng;
            editTrip.notes = notes;
        } else {
            modalDayTrips.push({
                id: 'dt_' + Date.now().toString(),
                name: name,
                lat: lat,
                lng: lng,
                notes: notes
            });
        }

        renderModalDayTrips();
        container.style.display = 'none';
        container.innerHTML = '';
    });

    setTimeout(() => searchInput.focus(), 50);
}

// Render Map Elements (Markers & Polyline)
function renderMapElements(overrideTheme) {
    const theme = overrideTheme || currentTheme;
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

        // Build day trips HTML for popup
        let dayTripsPopupHTML = '';
        if (loc.dayTrips && loc.dayTrips.length > 0) {
            dayTripsPopupHTML = `<p style="margin: 8px 0 4px 0; font-weight: bold; border-top: 1px solid #ddd; padding-top: 6px;">📍 Activities:</p>`;
            loc.dayTrips.forEach((trip, ti) => {
                const subNum = `${activeCount}-${String(ti + 1).padStart(2, '0')}`;
                dayTripsPopupHTML += `<p style="margin: 3px 0; font-size: 0.9em;"><strong>${subNum}</strong> ${trip.name}${trip.notes ? ` — ${trip.notes}` : ''}</p>`;
            });
        }

        if (!activitiesHTML && !dayTripsPopupHTML) {
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
                    ${dayTripsPopupHTML}
                </div>
            `);

        markers.push(marker);

        // Add bed marker for accommodation if coordinates exist
        if (loc.stayLat && loc.stayLng && !loc.disabled) {
            const bedIcon = L.divIcon({
                className: 'custom-map-marker',
                html: `<div style="
                    background-color: #9b59b6;
                    width: 26px;
                    height: 26px;
                    border-radius: 50%;
                    border: 2px solid white;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    box-shadow: 0 3px 8px rgba(0,0,0,0.4);
                "><i class="fa-solid fa-bed" style="font-size: 12px;"></i></div>`,
                iconSize: [26, 26],
                iconAnchor: [13, 13]
            });

            const bedMarker = L.marker([loc.stayLat, loc.stayLng], {
                icon: bedIcon,
                zIndexOffset: 800
            })
                .addTo(map)
                .bindPopup(`
                    <div style="font-family: 'Outfit', sans-serif; color: #0f172a; min-width: 180px;">
                        <h3 style="margin: 0 0 5px 0; color: #9b59b6; text-align: center;"><i class="fa-solid fa-bed"></i> Stay</h3>
                        <p style="margin: 5px 0; text-align: center;"><strong>${loc.placeToStay || 'Accommodation'}</strong></p>
                        ${loc.stayAddress ? `<p style="margin: 5px 0; font-size: 0.9em; color: #666; text-align: center;">${loc.stayAddress}</p>` : ''}
                        ${loc.stayDateFrom && loc.stayDateTo ? `<p style="margin: 8px 0 0 0; padding-top: 8px; border-top: 1px solid #ddd; text-align: center; font-size: 0.85em;">
                            <i class="fa-solid fa-moon" style="color: #9b59b6;"></i> 
                            <strong>${Math.round((new Date(loc.stayDateTo) - new Date(loc.stayDateFrom)) / (1000 * 60 * 60 * 24))} nights</strong>
                            ${loc.checkoutTime ? `<br><i class="fa-solid fa-clock" style="color: #888;"></i> Check-out: ${loc.checkoutTime}` : ''}
                        </p>` : ''}
                    </div>
                `);

            markers.push(bedMarker);
        }

        // Add day trip sub-markers
        if (loc.dayTrips && loc.dayTrips.length > 0 && !loc.disabled) {
            loc.dayTrips.forEach((trip, tripIndex) => {
                const subNum = String(tripIndex + 1).padStart(2, '0');
                const fullSubNum = `${activeCount}-${subNum}`;

                const dtIcon = L.divIcon({
                    className: 'custom-map-marker',
                    html: `<div style="
                        background-color: #f59e0b;
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
                        font-size: 11px;
                        box-shadow: 0 4px 10px rgba(0,0,0,0.5);
                    ">${subNum}</div>`,
                    iconSize: [30, 30],
                    iconAnchor: [15, 15]
                });

                const dtMarker = L.marker([trip.lat, trip.lng], {
                    icon: dtIcon,
                    zIndexOffset: 900
                })
                    .addTo(map)
                    .bindPopup(`
                        <div style="font-family: 'Outfit', sans-serif; color: #0f172a; min-width: 180px;">
                            <h3 style="margin: 0 0 5px 0; color: #f59e0b; text-align: center;">
                                <span style="font-size: 0.8em; opacity: 0.7;">${fullSubNum}</span> ${trip.name}
                            </h3>
                            <p style="margin: 3px 0; font-size: 0.85em; color: #666; text-align: center;">Activity from ${loc.name}</p>
                            ${trip.notes ? `<p style="margin: 5px 0; font-size: 0.9em;">${trip.notes}</p>` : ''}
                        </div>
                    `);

                markers.push(dtMarker);

                // Draw dashed connector line from parent to day trip
                if (!loc.hideDayTripLines) {
                    const dtLineColor = theme === 'light' ? '#d97706' : '#f59e0b';
                    const dtLine = L.polyline([[loc.lat, loc.lng], [trip.lat, trip.lng]], {
                        color: dtLineColor,
                        weight: 3,
                        opacity: 0.7,
                        dashArray: '10, 10',
                        lineCap: 'round'
                    }).addTo(map);
                    travelTimeMarkers.push(dtLine); // Reuse array for cleanup
                }
            });
        }
    });

    // Draw Polyline (Only for active locations)
    if (activeLocations.length > 1) {
        const lineColor = theme === 'light' ? '#000000' : '#00d2ff';

        // Add travel time labels at midpoints and draw line segments
        for (let i = 0; i < activeLocations.length - 1; i++) {
            const currentLoc = activeLocations[i];
            const nextLoc = activeLocations[i + 1];

            // Draw line to next if not hidden
            if (!currentLoc.hideNextLine) {
                const segment = L.polyline([[currentLoc.lat, currentLoc.lng], [nextLoc.lat, nextLoc.lng]], {
                    color: lineColor,
                    weight: 3,
                    opacity: 0.7,
                    dashArray: '10, 10',
                    lineCap: 'round'
                }).addTo(map);
                travelTimeMarkers.push(segment); // Reuse array for cleanup
            }

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
                const textColor = theme === 'light' ? '#000000' : '#f8fafc';

                // Get travel mode icon
                const modeIcons = {
                    'walking': '<i class="fa-solid fa-person-walking" style="margin-right: 4px;"></i>',
                    'biking': '<i class="fa-solid fa-person-biking" style="margin-right: 4px;"></i>',
                    'car': '<i class="fa-solid fa-car" style="margin-right: 4px;"></i>',
                    'train': '<i class="fa-solid fa-train" style="margin-right: 4px;"></i>',
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
function generateKML() {
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
        kml += `        <Data name="ticketNumber"><value>${escapeXml(loc.ticketNumber || '')}</value></Data>\n`;
        kml += `        <Data name="departureTime"><value>${escapeXml(loc.departureTime || '')}</value></Data>\n`;
        kml += `        <Data name="placeToStay"><value>${escapeXml(loc.placeToStay || '')}</value></Data>\n`;
        kml += `        <Data name="stayAddress"><value>${escapeXml(loc.stayAddress || '')}</value></Data>\n`;
        kml += `        <Data name="stayLat"><value>${loc.stayLat || ''}</value></Data>\n`;
        kml += `        <Data name="stayLng"><value>${loc.stayLng || ''}</value></Data>\n`;
        kml += `        <Data name="stayDateFrom"><value>${escapeXml(loc.stayDateFrom || '')}</value></Data>\n`;
        kml += `        <Data name="stayDateTo"><value>${escapeXml(loc.stayDateTo || '')}</value></Data>\n`;
        kml += `        <Data name="checkoutTime"><value>${escapeXml(loc.checkoutTime || '')}</value></Data>\n`;
        kml += `        <Data name="morningActivity"><value>${escapeXml(loc.activities?.morning || '')}</value></Data>\n`;
        kml += `        <Data name="afternoonActivity"><value>${escapeXml(loc.activities?.afternoon || '')}</value></Data>\n`;
        kml += `        <Data name="allDayActivity"><value>${escapeXml(loc.activities?.allDay || '')}</value></Data>\n`;
        kml += `        <Data name="kidsActivity"><value>${escapeXml(loc.kidsActivity || '')}</value></Data>\n`;
        kml += `        <Data name="foodBreakfast"><value>${escapeXml(loc.food?.breakfast || '')}</value></Data>\n`;
        kml += `        <Data name="foodLunch"><value>${escapeXml(loc.food?.lunch || '')}</value></Data>\n`;
        kml += `        <Data name="foodDinner"><value>${escapeXml(loc.food?.dinner || '')}</value></Data>\n`;
        kml += `        <Data name="foodOptions"><value>${escapeXml(loc.foodOptions || '')}</value></Data>\n`;
        kml += `        <Data name="funFact"><value>${escapeXml(loc.funFact || '')}</value></Data>\n`;
        kml += `        <Data name="phrases"><value>${escapeXml(loc.phrases || '')}</value></Data>\n`;
        kml += `        <Data name="tags"><value>${escapeXml(loc.tags || '')}</value></Data>\n`;
        kml += `        <Data name="stopDate"><value>${escapeXml(loc.stopDate || '')}</value></Data>\n`;
        kml += `        <Data name="disabled"><value>${loc.disabled || false}</value></Data>\n`;
        kml += `        <Data name="hideDayTripLines"><value>${loc.hideDayTripLines || false}</value></Data>\n`;
        kml += `        <Data name="hideNextLine"><value>${loc.hideNextLine || false}</value></Data>\n`;
        kml += `        <Data name="dayTrips"><value>${escapeXml(JSON.stringify(loc.dayTrips || []))}</value></Data>\n`;
        kml += '      </ExtendedData>\n';
        kml += '    </Placemark>\n';
    });

    kml += '  </Document>\n';
    kml += '</kml>';
    return kml;
}

function exportItinerary() {
    const kml = generateKML();
    const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = kmlFileName || 'travel_planner_itinerary.kml';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// File System Access API Functions (Linked Files)
const dbName = 'TravelPlannerDB';
const storeName = 'FileHandles';

async function getDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(storeName)) {
                db.createObjectStore(storeName);
            }
        };
        request.onsuccess = (event) => resolve(event.target.result);
        request.onerror = (event) => reject(event.target.error);
    });
}

async function saveHandleToDB(key, handle) {
    const db = await getDB();
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(handle, key);
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function getHandleFromDB(key) {
    const db = await getDB();
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).get(key);
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function linkFile(type) {
    try {
        const [handle] = await window.showOpenFilePicker({
            types: [
                {
                    description: type === 'kml' ? 'KML Files' : 'CSV Files',
                    accept: type === 'kml' ? { 'application/vnd.google-earth.kml+xml': ['.kml'] } : { 'text/csv': ['.csv'] },
                },
            ],
            multiple: false
        });

        if (type === 'kml') {
            kmlFileHandle = handle;
            const file = await handle.getFile();
            const text = await file.text();
            processKMLImport(text);
        } else {
            csvFileHandle = handle;
            const file = await handle.getFile();
            const text = await file.text();
            processCSVImport(text);
        }

        await saveHandleToDB(type, handle);
        updateFileStatusUI();
        alert(`${type.toUpperCase()} file linked successfully!`);
    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error(err);
            alert(`Error linking file: ${err.message}`);
        }
    }
}

async function restoreLinkedFiles() {
    try {
        kmlFileHandle = await getHandleFromDB('kml');
        csvFileHandle = await getHandleFromDB('csv');
        updateFileStatusUI();
    } catch (err) {
        console.error('Error restoring linked files:', err);
    }
}

async function verifyAccess() {
    try {
        if (kmlFileHandle) {
            const kmlPermission = await kmlFileHandle.requestPermission({ mode: 'readwrite' });
            if (kmlPermission === 'granted') {
                const file = await kmlFileHandle.getFile();
                const text = await file.text();
                processKMLImport(text);
            }
        }
        if (csvFileHandle) {
            const csvPermission = await csvFileHandle.requestPermission({ mode: 'readwrite' });
            if (csvPermission === 'granted') {
                const file = await csvFileHandle.getFile();
                const text = await file.text();
                processCSVImport(text);
            }
        }
        updateFileStatusUI();
    } catch (err) {
        console.error('Error verifying file access:', err);
        alert('Could not regain access to files. Please re-link them.');
    }
}

async function autoSaveToFile(type) {
    if (!autoSync) return;
    const handle = type === 'kml' ? kmlFileHandle : csvFileHandle;
    if (!handle) return;

    try {
        // Check permission silently first
        if (await handle.queryPermission({ mode: 'readwrite' }) !== 'granted') return;

        const writable = await handle.createWritable();
        let content = '';
        if (type === 'kml') {
            content = generateKML();
        } else {
            const headers = 'name,location,star_rating,price,type,dedicated_gluten_free,gf_menu_items,review,lat,lng';
            const rows = restaurants.map(r => `"${r.name}","${r.location}","${r.star_rating}","${r.price}","${r.type}","${r.dedicated_gluten_free}","${r.gf_menu_items}","${r.review}",${r.lat},${r.lng}`);
            content = [headers, ...rows].join('\n');
        }
        await writable.write(content);
        await writable.close();
        console.log(`${type.toUpperCase()} auto-saved to file.`);
    } catch (err) {
        console.warn(`Could not auto-save ${type}:`, err);
    }
}

// Network Sync (WebDAV) Functions
async function syncKML(action) {
    if (!syncEnabled || !syncUrl) return;

    updateSyncStatus('Syncing KML...', 'loading');

    // Normalize URL: Ensure no double slashes and correct path
    let url = syncUrl.endsWith('/') ? syncUrl : syncUrl + '/';
    url += kmlFileName;

    const headers = new Headers();
    headers.set('Authorization', 'Basic ' + btoa(syncUsername + ':' + syncPassword));

    try {
        if (action === 'push') {
            const kmlContent = generateKML();
            const response = await fetch(url, {
                method: 'PUT',
                headers: headers,
                body: kmlContent
            });

            if (!response.ok) throw new Error(`Server returned ${response.status}`);

            lastSyncTime = new Date().toLocaleTimeString();
            localStorage.setItem('travel_planner_last_sync_time', lastSyncTime);
            updateSyncStatus('KML Synced!', 'success');
        } else {
            // pull
            const response = await fetch(url, {
                method: 'GET',
                headers: headers
            });

            if (!response.ok) throw new Error(`Server returned ${response.status}`);
            const kmlText = await response.text();
            processKMLImport(kmlText);

            lastSyncTime = new Date().toLocaleTimeString();
            localStorage.setItem('travel_planner_last_sync_time', lastSyncTime);
            updateSyncStatus('KML Loaded!', 'success');
        }
    } catch (err) {
        console.error('KML Sync Error:', err);
        updateSyncStatus(`KML Error: ${err.message}`, 'error');
    }
}

async function syncCSV(action) {
    if (!syncEnabled || !syncUrl) return;

    updateSyncStatus('Syncing CSV...', 'loading');

    let url = syncUrl.endsWith('/') ? syncUrl : syncUrl + '/';
    url += csvFileName;

    const headers = new Headers();
    headers.set('Authorization', 'Basic ' + btoa(syncUsername + ':' + syncPassword));

    try {
        if (action === 'push') {
            const headersStr = 'name,location,star_rating,price,type,dedicated_gluten_free,gf_menu_items,review,lat,lng';
            const rows = restaurants.map(r => `"${r.name}","${r.location}","${r.star_rating}","${r.price}","${r.type}","${r.dedicated_gluten_free}","${r.gf_menu_items}","${r.review}",${r.lat},${r.lng}`);
            const content = [headersStr, ...rows].join('\n');

            const response = await fetch(url, {
                method: 'PUT',
                headers: headers,
                body: content
            });

            if (!response.ok) throw new Error(`Server returned ${response.status}`);

            lastSyncTime = new Date().toLocaleTimeString();
            localStorage.setItem('travel_planner_last_sync_time', lastSyncTime);
            updateSyncStatus('CSV Synced!', 'success');
        } else {
            // pull
            const response = await fetch(url, {
                method: 'GET',
                headers: headers
            });

            if (!response.ok) throw new Error(`Server returned ${response.status}`);
            const text = await response.text();
            processCSVImport(text);

            lastSyncTime = new Date().toLocaleTimeString();
            localStorage.setItem('travel_planner_last_sync_time', lastSyncTime);
            updateSyncStatus('CSV Loaded!', 'success');
        }
    } catch (err) {
        console.error('CSV Sync Error:', err);
        updateSyncStatus(`CSV Error: ${err.message}`, 'error');
    }
}

function updateSyncStatus(message, type) {
    const statusEl = document.getElementById('syncStatus');
    if (!statusEl) return;

    statusEl.innerText = `Status: ${message}`;
    statusEl.className = 'sync-status'; // Reset classes

    if (type === 'success') statusEl.classList.add('sync-success');
    if (type === 'error') statusEl.classList.add('sync-error');
    if (type === 'loading') statusEl.classList.add('sync-loading');

    // If it's a success, clear it after 5 seconds to show the last sync time
    if (type === 'success') {
        setTimeout(() => {
            statusEl.innerText = `Status: Ready (Last: ${lastSyncTime})`;
            statusEl.className = 'sync-status';
        }, 5000);
    }
}

function updateFileStatusUI() {
    const container = document.getElementById('fileStatusContainer');
    const kmlStatus = document.getElementById('kmlFileStatus');
    const csvStatus = document.getElementById('csvFileStatus');
    const verifyBtn = document.getElementById('verifyFileAccessBtn');

    if (!container) return;

    if (kmlFileHandle || csvFileHandle) {
        container.style.display = 'block';
        verifyBtn.style.display = 'block';

        if (kmlFileHandle) {
            kmlStatus.innerText = `KML Linked: ${kmlFileHandle.name}`;
            kmlStatus.className = 'sync-status sync-success';
        } else {
            kmlStatus.innerText = 'KML: Not Linked';
            kmlStatus.className = 'sync-status';
        }

        if (csvFileHandle) {
            csvStatus.innerText = `CSV Linked: ${csvFileHandle.name}`;
            csvStatus.className = 'sync-status sync-success';
        } else {
            csvStatus.innerText = 'CSV: Not Linked';
            csvStatus.className = 'sync-status';
        }
    } else {
        container.style.display = 'none';
    }
}

function processCSVImport(csvText) {
    const importedRestaurants = parseCSV(csvText);
    console.log(`Sync: Parsed ${importedRestaurants.length} restaurants.`);

    importedRestaurants.forEach(r => {
        // If it already has lat/lng, skip geocoding
        if (r.lat && r.lng) {
            addRestaurantMarker(r);
        } else {
            geocodeQueue.push({
                restaurant: r,
                onComplete: (geocodedRestaurant) => {
                    addRestaurantMarker(geocodedRestaurant);
                    // Save to linked file if auto-sync is on
                    if (autoSync) autoSaveToFile('csv');
                }
            });
        }
    });
    processGeocodeQueue();
}

function processKMLImport(kmlText) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(kmlText, 'text/xml');
    const placemarks = xmlDoc.querySelectorAll('Placemark');

    if (placemarks.length === 0) return;

    locations = Array.from(placemarks).map(placemark => {
        const coordsText = placemark.querySelector('coordinates')?.textContent.trim();
        const coords = coordsText ? coordsText.split(',') : [0, 0, 0];
        const lng = parseFloat(coords[0]) || 0;
        const lat = parseFloat(coords[1]) || 0;
        const name = placemark.querySelector('name')?.textContent || 'Unnamed Location';

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
            ticketNumber: getData('ticketNumber'),
            departureTime: getData('departureTime'),
            placeToStay: getData('placeToStay'),
            stayAddress: getData('stayAddress'),
            stayLat: getData('stayLat') ? parseFloat(getData('stayLat')) : null,
            stayLng: getData('stayLng') ? parseFloat(getData('stayLng')) : null,
            stayDateFrom: getData('stayDateFrom'),
            stayDateTo: getData('stayDateTo'),
            checkoutTime: getData('checkoutTime'),
            activities: {
                morning: getData('morningActivity'),
                afternoon: getData('afternoonActivity'),
                allDay: getData('allDayActivity')
            },
            kidsActivity: getData('kidsActivity'),
            food: {
                breakfast: getData('foodBreakfast'),
                lunch: getData('foodLunch'),
                dinner: getData('foodDinner')
            },
            foodOptions: getData('foodOptions'),
            funFact: getData('funFact'),
            phrases: getData('phrases'),
            tags: getData('tags'),
            stopDate: getData('stopDate'),
            disabled: getData('disabled') === 'true',
            hideDayTripLines: getData('hideDayTripLines') === 'true',
            hideNextLine: getData('hideNextLine') === 'true',
            dayTrips: (() => { try { const dt = getData('dayTrips'); return dt ? JSON.parse(dt) : []; } catch (e) { return []; } })()
        };
    });

    renderApp();
    localStorage.setItem('travel_planner_locations', JSON.stringify(locations));
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

// CSV Parsing Helper
function parseCSV(text) {
    const lines = text.split('\n');
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const results = [];

    for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;

        // Handle quoted fields (basic implementation)
        const row = [];
        let inQuote = false;
        let p = 0;
        let s = '';

        for (let j = 0; j < lines[i].length; j++) {
            const char = lines[i][j];
            if (char === '"') {
                inQuote = !inQuote;
            } else if (char === ',' && !inQuote) {
                row.push(s.trim());
                s = '';
            } else {
                s += char;
            }
        }
        row.push(s.trim()); // Push last field

        if (row.length === headers.length) {
            const obj = {};
            headers.forEach((h, index) => {
                obj[h] = row[index] ? row[index].replace(/^"|"$/g, '') : '';
            });
            results.push(obj);
        }
    }
    return results;
}

// Rate-limited Geocoding Queue
const geocodeQueue = [];
let isGeocoding = false;

async function processGeocodeQueue() {
    if (isGeocoding || geocodeQueue.length === 0) return;

    isGeocoding = true;
    const { restaurant, onComplete } = geocodeQueue.shift();

    try {
        const query = `${restaurant.location}`; // Add more context if needed
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
        const data = await response.json();

        if (data && data.length > 0) {
            const lat = parseFloat(data[0].lat);
            const lng = parseFloat(data[0].lon);
            onComplete({ ...restaurant, lat, lng });
        } else {
            console.warn(`Could not geocode: ${restaurant.name} (${restaurant.location})`);
        }
    } catch (error) {
        console.error('Geocoding error:', error);
    }

    // Wait 1.1 seconds before next request (Nominitim limit is 1/sec)
    setTimeout(() => {
        isGeocoding = false;
        processGeocodeQueue();
    }, 1100);
}

function addRestaurantMarker(r) {
    const color = '#f97316'; // Orange
    const iconHtml = `<div style="
        background-color: ${color};
        width: 28px;
        height: 28px;
        border-radius: 50%;
        border: 2px solid #fff;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        box-shadow: 0 4px 8px rgba(0,0,0,0.4);
    "><i class="fa-solid fa-utensils" style="font-size: 14px;"></i></div>`;

    const icon = L.divIcon({
        className: 'custom-restaurant-marker',
        html: iconHtml,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
    });

    const popupContent = `
        <div style="font-family: 'Outfit', sans-serif; color: #0f172a; min-width: 220px;">
            <h3 style="margin: 0 0 5px 0; color: ${color}; text-align: center;">${r.name}</h3>
            <div style="font-size: 0.9em; line-height: 1.4;">
                <p style="margin: 5px 0;"><strong>⭐ Rating:</strong> ${r.star_rating || 'N/A'}</p>
                <p style="margin: 5px 0;"><strong>💲 Price:</strong> ${r.price || 'N/A'}</p>
                <p style="margin: 5px 0;"><strong>🍽️ Type:</strong> ${r.type || 'N/A'}</p>
                ${r.dedicated_gluten_free === 'Yes' ? '<p style="margin: 5px 0; color: #16a34a;"><strong>✅ Dedicated GF</strong></p>' : ''}
                ${r.gf_menu_items ? `<p style="margin: 5px 0;"><strong>📋 GF Items:</strong> ${r.gf_menu_items}</p>` : ''}
                ${r.review ? `<p style="margin: 8px 0; padding-top: 8px; border-top: 1px solid #eee; font-style: italic; color: #666;">"${r.review}"</p>` : ''}
                <p style="margin: 5px 0; color: #888; font-size: 0.8em;">📍 ${r.location}</p>
            </div>
        </div>
    `;

    const marker = L.marker([r.lat, r.lng], { icon: icon })
        .addTo(map)
        .bindPopup(popupContent);

    restaurantMarkers.push(marker);

    // Save to state if not already there
    if (!restaurants.find(item => item.name === r.name && item.location === r.location)) {
        restaurants.push(r);
        saveData();
    }

    // Respect toggle
    if (!showRestaurants) {
        map.removeLayer(marker);
    }
}

function toggleRestaurantsVisibility(show) {
    showRestaurants = show;
    localStorage.setItem('travel_planner_show_restaurants', show);

    restaurantMarkers.forEach(marker => {
        if (show) {
            if (!map.hasLayer(marker)) marker.addTo(map);
        } else {
            if (map.hasLayer(marker)) map.removeLayer(marker);
        }
    });

    // Save preference
    localStorage.setItem('travel_planner_show_restaurants', show);
}

// Supermarket Logic
async function fetchSupermarkets() {
    if (!showSupermarkets) return; // Don't fetch if turned off

    // Clear existing supermarkets first to avoid duplicates
    supermarketMarkers.forEach(m => map.removeLayer(m));
    supermarketMarkers = [];

    const activeLocations = locations.filter(l => !l.disabled);
    if (activeLocations.length === 0) return;

    console.log('Fetching supermarkets...');

    // Iterate through locations and fetch supermarkets near each
    for (const loc of activeLocations) {
        try {
            // Overpass API Query
            // Search for nodes with shop=supermarket or shop=convenience within 30km (30000m)
            const query = `
                [out:json][timeout:25];
                (
                  node["shop"="supermarket"](around:10000,${loc.lat},${loc.lng});
                );
                out body 20; 
            `;
            // 'out body 20' limits to 20 results per location to prevent overload

            const response = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`);
            const data = await response.json();

            if (data.elements) {
                data.elements.forEach(el => {
                    addSupermarketMarker(el);
                });
            }

        } catch (error) {
            console.error('Error fetching supermarkets:', error);
        }

        // Small delay to be nice to the API
        await new Promise(r => setTimeout(r, 500));
    }
}

function addSupermarketMarker(el) {
    const color = '#10b981'; // Emerald Green
    const iconHtml = `<div style="
        background-color: ${color};
        width: 24px;
        height: 24px;
        border-radius: 50%;
        border: 2px solid #fff;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        box-shadow: 0 3px 6px rgba(0,0,0,0.3);
    "><i class="fa-solid fa-cart-shopping" style="font-size: 12px;"></i></div>`;

    const icon = L.divIcon({
        className: 'custom-supermarket-marker',
        html: iconHtml,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    });

    const marker = L.marker([el.lat, el.lon], { icon: icon })
        .addTo(map)
        .bindPopup(`
            <div style="font-family: 'Outfit', sans-serif; color: #0f172a;">
                <h4 style="margin: 0 0 5px 0; color: ${color};">${el.tags.name || 'Supermarket'}</h4>
                ${el.tags.brand ? `<p style="margin: 0; font-size: 0.9em;">Brand: ${el.tags.brand}</p>` : ''}
                ${el.tags.opening_hours ? `<p style="margin: 0; font-size: 0.8em; color: #666;">🕒 ${el.tags.opening_hours}</p>` : ''}
            </div>
        `);

    supermarketMarkers.push(marker);
}

function toggleSupermarketsVisibility(show) {
    showSupermarkets = show;

    if (show) {
        if (supermarketMarkers.length === 0) {
            fetchSupermarkets();
        } else {
            supermarketMarkers.forEach(marker => {
                if (!map.hasLayer(marker)) marker.addTo(map);
            });
        }
    } else {
        supermarketMarkers.forEach(marker => {
            if (map.hasLayer(marker)) map.removeLayer(marker);
        });
    }
}

function importRestaurants(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        const csvText = e.target.result;
        const restaurants = parseCSV(csvText);

        console.log(`Parsed ${restaurants.length} restaurants. Starting geocoding...`);
        alert(`Found ${restaurants.length} restaurants. They will appear on the map as they are geocoded (this may take a while).`);

        restaurants.forEach(r => {
            geocodeQueue.push({
                restaurant: r,
                onComplete: (geocodedRestaurant) => {
                    addRestaurantMarker(geocodedRestaurant);
                    // Push to network if auto-sync is on (debounced or after all done would be better, but this works for now)
                    if (syncEnabled && autoSync) syncCSV('push');
                }
            });
        });

        processGeocodeQueue();
    };
    reader.readAsText(file);
    // Reset input
    event.target.value = '';
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
                        ticketNumber: getData('ticketNumber'),
                        departureTime: getData('departureTime'),
                        placeToStay: getData('placeToStay'),
                        stayAddress: getData('stayAddress'),
                        stayLat: getData('stayLat') ? parseFloat(getData('stayLat')) : null,
                        stayLng: getData('stayLng') ? parseFloat(getData('stayLng')) : null,
                        stayDateFrom: getData('stayDateFrom'),
                        stayDateTo: getData('stayDateTo'),
                        checkoutTime: getData('checkoutTime'),
                        activities: {
                            morning: getData('morningActivity'),
                            afternoon: getData('afternoonActivity'),
                            allDay: getData('allDayActivity')
                        },
                        kidsActivity: getData('kidsActivity'),
                        food: {
                            breakfast: getData('foodBreakfast'),
                            lunch: getData('foodLunch'),
                            dinner: getData('foodDinner')
                        },
                        foodOptions: getData('foodOptions'),
                        funFact: getData('funFact'),
                        phrases: getData('phrases'),
                        tags: getData('tags'),
                        stopDate: getData('stopDate'),
                        disabled: getData('disabled') === 'true',
                        hideDayTripLines: getData('hideDayTripLines') === 'true',
                        hideNextLine: getData('hideNextLine') === 'true',
                        dayTrips: (() => { try { const dt = getData('dayTrips'); return dt ? JSON.parse(dt) : []; } catch (e) { return []; } })()
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

function moveCard(id, direction) {
    const index = locations.findIndex(l => l.id === id);
    if (index === -1) return;

    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= locations.length) return;

    // Swap
    const temp = locations[index];
    locations[index] = locations[targetIndex];
    locations[targetIndex] = temp;

    renderApp();
    saveData();

    // Re-scroll card into view smoothly
    setTimeout(() => {
        const movedCard = document.querySelector(`[data-id="${id}"]`);
        if (movedCard) movedCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
}

function updateStats() {
    locationCount.innerText = `${locations.length} Stop${locations.length !== 1 ? 's' : ''}`;
}

function saveData() {
    localStorage.setItem('travel_planner_locations', JSON.stringify(locations));
    localStorage.setItem('travel_planner_collapsed_groups', JSON.stringify(collapsedGroups));
    localStorage.setItem('travel_planner_restaurants', JSON.stringify(restaurants));

    // Save Sync Settings
    localStorage.setItem('travel_planner_auto_sync', autoSync);
    localStorage.setItem('travel_planner_sync_enabled', syncEnabled);
    localStorage.setItem('travel_planner_sync_url', syncUrl);
    localStorage.setItem('travel_planner_kml_filename', kmlFileName);
    localStorage.setItem('travel_planner_csv_filename', csvFileName);
    localStorage.setItem('travel_planner_sync_username', syncUsername);
    localStorage.setItem('travel_planner_sync_password', syncPassword);

    // Linked File Auto-Save
    if (autoSync) {
        autoSaveToFile('kml');
        if (syncEnabled) {
            syncKML('push');
        }
    }
}

function toggleGroup(tagName) {
    if (collapsedGroups.includes(tagName)) {
        collapsedGroups = collapsedGroups.filter(g => g !== tagName);
    } else {
        collapsedGroups.push(tagName);
    }
    saveData();
    renderItineraryList();
}

function updateTagSuggestions() {
    const tagListEl = document.getElementById('tagList');
    const suggestedTagsContainer = document.getElementById('suggestedTags');
    const tagsInput = document.getElementById('locationTags');
    if (!tagListEl || !suggestedTagsContainer || !tagsInput) return;

    const uniqueTags = new Set();
    locations.forEach(loc => {
        if (loc.tags) {
            loc.tags.split(',').forEach(tag => {
                const trimmed = tag.trim();
                if (trimmed) uniqueTags.add(trimmed);
            });
        }
    });

    const sortedTags = Array.from(uniqueTags).sort();

    // Update datalist (kept for browser auto-fill)
    tagListEl.innerHTML = sortedTags
        .map(tag => `<option value="${tag}">`)
        .join('');

    // Update clickable suggestions
    const currentTags = tagsInput.value.split(',').map(t => t.trim().toLowerCase());

    suggestedTagsContainer.innerHTML = sortedTags
        .map(tag => {
            const isActive = currentTags.includes(tag.toLowerCase());
            return `
                <span class="suggested-tag ${isActive ? 'active' : ''}" data-tag="${tag}">
                    ${tag}
                    <i class="fa-solid fa-xmark delete-tag-btn" title="Delete tag globally"></i>
                </span>
            `;
        })
        .join('');

    // Add click handlers
    suggestedTagsContainer.querySelectorAll('.suggested-tag').forEach(span => {
        span.addEventListener('click', () => {
            const tag = span.dataset.tag;
            let tags = tagsInput.value.split(',').map(t => t.trim()).filter(t => t !== '');
            const tagLower = tag.toLowerCase();
            const index = tags.findIndex(t => t.toLowerCase() === tagLower);

            if (index > -1) {
                // Remove tag
                tags.splice(index, 1);
            } else {
                // Add tag
                tags.push(tag);
            }

            tagsInput.value = tags.join(', ');
            updateTagSuggestions(); // Refresh active states
        });

        // Add handler for global delete
        const deleteBtn = span.querySelector('.delete-tag-btn');
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Don't toggle the tag
            const tag = span.dataset.tag;
            if (confirm(`Are you sure you want to delete the tag "${tag}" from ALL locations?`)) {
                deleteTagGlobally(tag);
            }
        });
    });
}

function deleteTagGlobally(tagName) {
    const tagNameLower = tagName.toLowerCase();
    locations.forEach(loc => {
        if (loc.tags) {
            let tags = loc.tags.split(',').map(t => t.trim());
            tags = tags.filter(t => t.toLowerCase() !== tagNameLower);
            loc.tags = tags.join(', ');
        }
    });
    saveData();
    renderApp(); // Re-render both map and list
}

// Render Itinerary List
function renderItineraryList() {
    itineraryList.innerHTML = '';

    // Calculate most frequent tag for title (weighted by activities)
    let tagCounts = {};
    locations.forEach(loc => {
        if (loc.tags) {
            let weight = 1 + (loc.dayTrips ? loc.dayTrips.length : 0);
            loc.tags.split(',').forEach(tag => {
                const t = tag.trim();
                if (t) tagCounts[t] = (tagCounts[t] || 0) + weight;
            });
        }
    });
    
    let topTag = '';
    let maxCount = 0;
    for (const [tag, count] of Object.entries(tagCounts)) {
        if (count > maxCount) {
            maxCount = count;
            topTag = tag;
        }
    }
    
    const journeyTitle = document.querySelector('.itinerary-header h2');
    if (journeyTitle) {
        journeyTitle.textContent = topTag ? `${topTag} Trip` : 'Your Journey';
    }

    if (locations.length === 0) {
        itineraryList.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-map-location-dot"></i>
                <p>No locations added yet. Click on the map to start planning!</p>
            </div>
        `;
        return;
    }

    if (groupingEnabled) {
        renderGroupedList();
    } else {
        let activeCount = 0;
        locations.forEach((loc, index) => {
            const card = createLocationCard(loc, index, activeCount);
            if (!loc.disabled) activeCount++;
            itineraryList.appendChild(card);
        });
    }
}

function renderGroupedList() {
    // Group locations by first tag (if multiple) or "Untagged"
    // Use a normalization map to keep track of the display version vs normalized version
    const groups = {};
    const normalizedToDisplay = {};

    locations.forEach(loc => {
        const rawTag = loc.tags ? loc.tags.split(',')[0].trim() : 'Untagged';
        const normTag = rawTag.toLowerCase();

        if (!normalizedToDisplay[normTag]) {
            normalizedToDisplay[normTag] = rawTag;
        }

        const groupName = normalizedToDisplay[normTag];
        if (!groups[groupName]) groups[groupName] = [];
        groups[groupName].push(loc);
    });

    // Sort group names: Alphabetical but "Untagged" at the end
    const sortedGroupNames = Object.keys(groups).sort((a, b) => {
        if (a === 'Untagged') return 1;
        if (b === 'Untagged') return -1;
        return a.localeCompare(b);
    });

    // We still need to know the global active index for card numbering
    // Pre-calculate active indices
    const activeIndices = new Map();
    let currentActiveCount = 0;
    locations.forEach((loc, idx) => {
        if (!loc.disabled) {
            activeIndices.set(loc.id, currentActiveCount);
            currentActiveCount++;
        }
    });

    sortedGroupNames.forEach(tagName => {
        const groupLocations = groups[tagName];
        const isCollapsed = collapsedGroups.includes(tagName);

        const header = document.createElement('div');
        header.className = `group-header ${isCollapsed ? 'collapsed' : ''}`;
        header.innerHTML = `
            <h4><i class="fa-solid fa-tag"></i> ${tagName}</h4>
            <div style="flex-grow: 1;"></div>
            <div style="display: flex; align-items: center; gap: 0.8rem;">
                <span class="group-count">${groupLocations.length} items</span>
                <i class="fa-solid fa-chevron-down"></i>
            </div>
        `;

        header.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleGroup(tagName);
        });

        itineraryList.appendChild(header);

        const content = document.createElement('div');
        content.className = 'group-content';

        groupLocations.forEach(loc => {
            const globalActiveCount = activeIndices.get(loc.id) || 0;
            const card = createLocationCard(loc, locations.indexOf(loc), globalActiveCount);
            content.appendChild(card);
        });

        itineraryList.appendChild(content);
    });

    // Add spacer at the bottom to ensure the last card isn't cut off
    const spacer = document.createElement('div');
    spacer.style.height = '100px';
    spacer.style.flexShrink = '0';
    itineraryList.appendChild(spacer);
}

function createLocationCard(loc, index, activeCount) {
    const card = document.createElement('div');
    card.className = `location-card ${loc.disabled ? 'disabled' : ''}`;
    card.dataset.id = loc.id;

    // Calculate number only for active items
    let displayNumber = '';
    if (!loc.disabled) {
        displayNumber = activeCount + 1;
    }

    const bgImage = loc.imageUrl || 'https://github.com/mong00se007/travel/raw/main/images/default.png';

    // Build activities HTML
    let activitiesHTML = '';
    if (loc.activities) {
        if (loc.activities.allDay) {
            activitiesHTML += `<div class="detail-row"><i class="fa-solid fa-calendar-day fa-fw" style="color: #10b981;"></i> <span><strong>All Day:</strong> ${loc.activities.allDay}</span></div>`;
        }
        if (loc.activities.morning) {
            activitiesHTML += `<div class="detail-row"><i class="fa-solid fa-sun fa-fw" style="color: #10b981;"></i> <span><strong>Morning:</strong> ${loc.activities.morning}</span></div>`;
        }
        if (loc.activities.afternoon) {
            activitiesHTML += `<div class="detail-row"><i class="fa-solid fa-cloud-sun fa-fw" style="color: #10b981;"></i> <span><strong>Afternoon:</strong> ${loc.activities.afternoon}</span></div>`;
        }
    }

    // Tags HTML
    let tagsHTML = '';
    if (loc.tags) {
        const tagList = loc.tags.split(',').map(t => t.trim()).filter(t => t !== '');
        if (tagList.length > 0) {
            tagsHTML = `<div class="card-tags">` + tagList.map(t => `<span class="tag-badge">${t}</span>`).join('') + `</div>`;
        }
    }

    // Format Dates
    let dateStr = '';
    if (loc.stayDateFrom && loc.stayDateTo) {
        dateStr = `${new Date(loc.stayDateFrom).toLocaleDateString()} - ${new Date(loc.stayDateTo).toLocaleDateString()}`;
    } else if (loc.stayDateFrom) {
        dateStr = `Check-in: ${new Date(loc.stayDateFrom).toLocaleDateString()}`;
    }

    // Calculate Travel Time if missing
    let displayTravelTime = loc.travelTime;
    if (!displayTravelTime && index > 0) {
        const prevIndex = index - 1;
        if (prevIndex >= 0) {
            const prev = locations[prevIndex];
            const dist = calculateDistance(prev.lat, prev.lng, loc.lat, loc.lng);
            displayTravelTime = estimateTravelTime(dist, loc.travelMode || 'car');
        }
    }

    card.innerHTML = `
        <div class="card-image" style="background-image: url('${bgImage}')">
            <div class="card-header-overlay">
                ${!loc.disabled ? `<div class="card-number">${displayNumber}</div>` : ''}
                <h3 class="card-title">${loc.name}</h3>
            </div>
            ${loc.stopDate ? `<div class="card-date"><i class="fa-solid fa-calendar-day fa-fw" style="color: #0ea5e9;"></i> ${(() => {
            const d = new Date(loc.stopDate);
            const datePart = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
            const dayPart = d.toLocaleDateString('en-GB', { weekday: 'short' });
            return `${datePart} (${dayPart})`;
        })()}</div>` : ''}
            <div class="card-weather" id="weather-${loc.id}">
                <i class="fa-solid fa-spinner fa-spin"></i>
            </div>
            <div class="card-actions">
                <button class="card-action-btn mobile-move-up" onclick="event.stopPropagation(); moveCard('${loc.id}', 'up')" title="Move Up">
                    <i class="fa-solid fa-chevron-up"></i>
                </button>
                <button class="card-action-btn mobile-move-down" onclick="event.stopPropagation(); moveCard('${loc.id}', 'down')" title="Move Down">
                    <i class="fa-solid fa-chevron-down"></i>
                </button>
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
                ${loc.travelMode ? `<div class="meta-item"><i class="fa-solid fa-${loc.travelMode === 'walking' ? 'person-walking' : loc.travelMode === 'biking' ? 'person-biking' : loc.travelMode === 'train' ? 'train' : loc.travelMode === 'boat' ? 'sailboat' : loc.travelMode === 'plane' ? 'plane' : 'car'} fa-fw" style="color: #64748b;"></i>${displayTravelTime ? ` ${displayTravelTime}` : ''}</div>` : (displayTravelTime ? `<div class="meta-item"><i class="fa-solid fa-clock fa-fw" style="color: #64748b;"></i> ${displayTravelTime}</div>` : '')}
                ${loc.departureTime ? `<div class="meta-item"><i class="fa-solid fa-plane-departure fa-fw" style="color: #64748b;"></i> ${loc.departureTime}</div>` : ''}
                ${loc.ticketNumber ? `<div class="meta-item"><i class="fa-solid fa-ticket fa-fw" style="color: #64748b;"></i> ${loc.ticketNumber}</div>` : ''}
                <div class="meta-item no-print" title="Toggle route line to next destination">
                    <label class="grouping-toggle" style="margin: 0; display: flex; align-items: center; gap: 0.3rem; cursor: pointer;">
                        <span style="font-size: 0.75rem;">Line to next</span>
                        <div class="toggle-switch small" style="margin: 0;">
                            <input type="checkbox" onchange="event.stopPropagation(); toggleNextLine('${loc.id}', this.checked)" ${!loc.hideNextLine ? 'checked' : ''}>
                            <span class="slider" onclick="event.stopPropagation();"></span>
                        </div>
                    </label>
                </div>
            </div>
            <div class="card-details">
                ${loc.placeToStay ? `
                    <div class="detail-row">
                        <i class="fa-solid fa-bed fa-fw" style="color: #9b59b6;"></i> 
                        <div>
                            <strong>${loc.placeToStay}</strong>
                            ${loc.stayAddress ? `<div style="font-size: 0.8em; color: #999;">${loc.stayAddress}</div>` : ''}
                            ${dateStr ? `<div style="font-size: 0.8em; color: #999;">${dateStr}${loc.stayDateFrom && loc.stayDateTo ? ` <span style="color: #666;">(${Math.round((new Date(loc.stayDateTo) - new Date(loc.stayDateFrom)) / (1000 * 60 * 60 * 24))} nights)</span>` : ''}</div>` : ''}
                            ${loc.checkoutTime ? `<div style="font-size: 0.8em; color: #999;"><i class="fa-solid fa-clock fa-fw"></i> Check-out: ${loc.checkoutTime}</div>` : ''}
                        </div>
                    </div>` : ''}
                ${activitiesHTML}
                ${loc.kidsActivity ? `<div class="detail-row"><i class="fa-solid fa-child-reaching fa-fw" style="color: #ec4899;"></i> <span>Kids: ${loc.kidsActivity}</span></div>` : ''}
                ${(() => {
            // Activities Section
            const trips = loc.dayTrips || [];
            let dtHTML = `<div class="day-trips-section ${trips.length === 0 ? 'empty-day-trips' : ''}">`;
            dtHTML += `<div class="day-trips-header" style="justify-content: space-between;">
                                   <div style="display: flex; align-items: center; gap: 0.5rem;"><i class="fa-solid fa-map-pin fa-fw" style="color: #f59e0b;"></i> Activities</div>
                                   ${trips.length > 0 ? `
                                   <label class="grouping-toggle no-print" title="Toggle connector lines on map" style="margin: 0; display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
                                       <span style="font-size: 0.75rem;">Lines</span>
                                       <div class="toggle-switch small" style="margin: 0;">
                                           <input type="checkbox" onchange="event.stopPropagation(); toggleDayTripLines('${loc.id}', this.checked)" ${!loc.hideDayTripLines ? 'checked' : ''}>
                                           <span class="slider" onclick="event.stopPropagation();"></span>
                                       </div>
                                   </label>` : ''}
                               </div>`;
            dtHTML += `<div class="day-trips-list">`;
            trips.forEach((trip, ti) => {
                const subNum = String(ti + 1).padStart(2, '0');
                dtHTML += `
                            <div class="day-trip-item" data-trip-id="${trip.id}">
                                <div class="day-trip-number"><span class="no-print">${displayNumber}-</span>${subNum}</div>
                                <div class="day-trip-info">
                                    <div class="day-trip-name">${trip.name}</div>
                                    ${trip.notes ? `<div class="day-trip-notes">${trip.notes}</div>` : ''}
                                </div>
                                <div class="day-trip-actions no-print">
                                    <button class="day-trip-action-btn edit" onclick="event.stopPropagation(); addDayTrip('${loc.id}', '${trip.id}')" title="Edit"><i class="fa-solid fa-pen"></i></button>
                                    <button class="day-trip-action-btn" onclick="event.stopPropagation(); moveDayTrip('${loc.id}', '${trip.id}', 'up')" title="Move Up"><i class="fa-solid fa-chevron-up"></i></button>
                                    <button class="day-trip-action-btn" onclick="event.stopPropagation(); moveDayTrip('${loc.id}', '${trip.id}', 'down')" title="Move Down"><i class="fa-solid fa-chevron-down"></i></button>
                                    <button class="day-trip-action-btn delete" onclick="event.stopPropagation(); removeDayTrip('${loc.id}', '${trip.id}')" title="Remove"><i class="fa-solid fa-xmark"></i></button>
                                </div>
                            </div>`;
            });
            dtHTML += `</div>`;
            dtHTML += `<button class="add-day-trip-btn no-print" onclick="event.stopPropagation(); addDayTrip('${loc.id}')"><i class="fa-solid fa-plus"></i> Add Activity</button>`;
            dtHTML += `</div>`;
            return dtHTML;
        })()}
                ${loc.food && loc.food.breakfast ? `<div class="detail-row"><i class="fa-solid fa-mug-hot fa-fw" style="color: #eab308;"></i> <span><strong>Breakfast:</strong> ${loc.food.breakfast}</span></div>` : ''}
                ${loc.food && loc.food.lunch ? `<div class="detail-row"><i class="fa-solid fa-burger fa-fw" style="color: #eab308;"></i> <span><strong>Lunch:</strong> ${loc.food.lunch}</span></div>` : ''}
                ${loc.food && loc.food.dinner ? `<div class="detail-row"><i class="fa-solid fa-utensils fa-fw" style="color: #eab308;"></i> <span><strong>Dinner:</strong> ${loc.food.dinner}</span></div>` : ''}
                ${loc.foodOptions ? `<div class="detail-row"><i class="fa-solid fa-utensils fa-fw" style="color: #eab308;"></i> <span>Food: ${loc.foodOptions}</span></div>` : ''}
                ${loc.funFact ? `<div class="fun-fact"><i class="fa-solid fa-lightbulb fa-fw" style="color: #f59e0b; margin-right: 5px;"></i> ${loc.funFact}</div>` : ''}
                ${loc.phrases ? `<div class="phrases-section"><strong><i class="fa-solid fa-language fa-fw" style="color: #10b981;"></i> Phrases:</strong> ${loc.phrases}</div>` : ''}
                ${tagsHTML}
            </div>
        </div>
    `;

    // Fetch weather
    fetchWeather(loc.lat, loc.lng, `weather-${loc.id}`);

    // Add click handler
    card.addEventListener('click', function (e) {
        if (e.target.closest('.card-action-btn')) return;
        this.classList.toggle('expanded');

        if (globeView && globeInstance) {
            // If in globe view, fly there first then transition to map
            globeInstance.pointOfView({ lat: loc.lat, lng: loc.lng, altitude: 0.8 }, 1500);

            // Start transition to flat map after globe zoom starts
            setTimeout(() => {
                executeViewSwap(false, { lat: loc.lat, lng: loc.lng, altitude: 0.8 });
            }, 1000);
        } else {
            // Normal map behavior
            map.setView([loc.lat, loc.lng], 10, { animate: true });
        }
    });

    return card;
}

// Modal & Form Logic
function openModal(editId = null) {
    locationModal.classList.add('active');
    updateTagSuggestions();

    // Inner Tab Logic (Activities)
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

    // Main Tab Logic
    const mainTabs = document.querySelectorAll('.main-tab');
    const mainContents = document.querySelectorAll('.main-tab-content');

    // Reset to first tab when opening modal
    mainTabs.forEach(t => t.classList.remove('active'));
    mainContents.forEach(c => c.classList.remove('active'));
    if (mainTabs.length > 0) mainTabs[0].classList.add('active');
    if (mainContents.length > 0) mainContents[0].classList.add('active');

    mainTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            mainTabs.forEach(t => t.classList.remove('active'));
            mainContents.forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
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
        document.getElementById('imageUrl').value = loc.imageUrl || '';
        document.getElementById('travelTime').value = loc.travelTime || '';
        const mode = loc.travelMode || '';
        document.getElementById('travelMode').value = mode;

        // Set active button
        if (mode) {
            const activeBtn = document.querySelector(`.travel-mode-btn[data-mode="${mode}"]`);
            if (activeBtn) activeBtn.classList.add('active');
        }

        document.getElementById('ticketNumber').value = loc.ticketNumber || '';
        document.getElementById('departureTime').value = loc.departureTime || '';
        document.getElementById('stopDate').value = loc.stopDate || '';

        document.getElementById('placeToStay').value = loc.placeToStay || '';
        document.getElementById('stayAddress').value = loc.stayAddress || '';
        document.getElementById('stayLat').value = loc.stayLat || '';
        document.getElementById('stayLng').value = loc.stayLng || '';
        document.getElementById('stayDateFrom').value = loc.stayDateFrom || '';
        document.getElementById('stayDateTo').value = loc.stayDateTo || '';
        document.getElementById('checkoutTime').value = loc.checkoutTime || '';

        document.getElementById('morningActivity').value = loc.activities?.morning || '';
        document.getElementById('afternoonActivity').value = loc.activities?.afternoon || '';
        document.getElementById('allDayActivity').value = loc.activities?.allDay || '';
        document.getElementById('kidsActivity').value = loc.kidsActivity;
        document.getElementById('foodBreakfast').value = loc.food?.breakfast || '';
        document.getElementById('foodLunch').value = loc.food?.lunch || '';
        document.getElementById('foodDinner').value = loc.food?.dinner || '';
        if (loc.foodOptions && !loc.food) {
            document.getElementById('foodDinner').value = loc.foodOptions;
        }
        document.getElementById('funFact').value = loc.funFact;
        document.getElementById('phrases').value = loc.phrases || '';
        document.getElementById('locationTags').value = loc.tags || '';

        // Load day trips into modal state
        modalDayTrips = JSON.parse(JSON.stringify(loc.dayTrips || []));
        renderModalDayTrips();
    } else {
        // Add Mode
        document.getElementById('modalTitle').innerText = 'Add Location';
        locationForm.reset();
        if (locationSearch) locationSearch.value = ''; // Clear search
        document.getElementById('locationId').value = '';
        if (tempClickCoords) {
            document.getElementById('locationLat').value = tempClickCoords.lat.toFixed(6);
            document.getElementById('locationLng').value = tempClickCoords.lng.toFixed(6);
        }

        // Clear day trips for new location
        modalDayTrips = [];
        renderModalDayTrips();
    }

    // Wire up modal Add Day Trip button
    const addBtn = document.getElementById('modalAddDayTripBtn');
    if (addBtn) {
        // Remove old listener by cloning
        const newBtn = addBtn.cloneNode(true);
        addBtn.parentNode.replaceChild(newBtn, addBtn);
        newBtn.addEventListener('click', (e) => {
            e.preventDefault();
            showModalDayTripForm();
        });
    }
}

function closeModal() {
    locationModal.classList.remove('active');
    tempClickCoords = null;
}

// Helper: convert globe altitude to Leaflet zoom level
function altitudeToZoom(alt) {
    // Adjusted mapping to match visual scale (Zoom 4 = Alt 0.5)
    return Math.max(2, Math.min(14, Math.round(4 - Math.log2(alt / 0.5))));
}

// Helper: convert Leaflet zoom to globe altitude
function zoomToAltitude(zoom) {
    // Inverse: matches map scale better at transition levels
    return Math.pow(2, 4 - zoom) * 0.5;
}

function executeViewSwap(toGlobe, targetPov) {
    if (isTransitioning) return;
    isTransitioning = true;

    const overlay = document.getElementById('map-transition-overlay');
    if (overlay) overlay.classList.add('active');

    // Ensure globe rotation is suppressed during transition
    if (globeInstance) {
        globeInstance.controls().autoRotate = false;
    }

    // Wait for fade in
    setTimeout(() => {
        performToggleGlobeView(toGlobe, targetPov);

        // Wait for swap to settle
        setTimeout(() => {
            if (overlay) overlay.classList.remove('active');
            // Unlock transitions after the overlay has faded out
            setTimeout(() => {
                isTransitioning = false;
            }, 600);
        }, 300);
    }, 600);
}

function toggleGlobeView(enabled) {
    // This is the manual toggle from UI
    globeView = enabled;
    localStorage.setItem('travel_planner_globe_view', enabled);

    const center = map.getCenter();
    const zoom = map.getZoom();
    const targetAlt = zoomToAltitude(zoom);

    executeViewSwap(enabled, { lat: center.lat, lng: center.lng, altitude: targetAlt });
}

function performToggleGlobeView(enabled, targetPov) {
    isGlobeActive = enabled;
    const mapEl = document.getElementById('map');
    const globeContainerEl = document.getElementById('globe-container');

    if (enabled) {
        mapEl.style.display = 'none';
        globeContainerEl.style.display = 'block';

        // Force dimension sync before initialization
        const width = globeContainerEl.clientWidth || 600;
        const height = globeContainerEl.clientHeight || 500;

        initGlobe(targetPov);

        if (globeInstance) {
            globeInstance.width(width).height(height);
        }
    } else {
        if (globeInstance) {
            globeInstance._destructor && globeInstance._destructor();
            globeContainerEl.innerHTML = '';
            globeInstance = null;
        }
        globeContainerEl.style.display = 'none';
        mapEl.style.display = 'block';
        setTimeout(() => {
            map.invalidateSize();
            if (targetPov) {
                const zoom = altitudeToZoom(targetPov.altitude) + 1.5;
                // Animate the final zoom into the location for a "landing" effect
                map.setView([targetPov.lat, targetPov.lng], zoom, { animate: true, duration: 1.5 });
            }
        }, 100);
    }
}

function initGlobe(initialPov = null) {
    const globeContainerEl = document.getElementById('globe-container');
    globeContainerEl.innerHTML = '';

    if (typeof Globe === 'undefined') {
        globeContainerEl.innerHTML = '<div style="color:#fff;text-align:center;padding:2rem;">Globe.gl failed to load. Check your connection.</div>';
        return;
    }

    const isDark = currentTheme === 'dark';

    globeInstance = Globe()
        .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
        .bumpImageUrl('https://unpkg.com/three-globe/example/img/earth-topology.png')
        .atmosphereColor(isDark ? '#00d2ff' : '#3a7bd5')
        .atmosphereAltitude(0.12)
        .backgroundColor(isDark ? '#090e1a' : '#e8f4fd')
        .width(globeContainerEl.clientWidth || 600)
        .height(globeContainerEl.clientHeight || 500)
        (globeContainerEl);

    // If we have an aligned start position, jump to it immediately
    if (initialPov) {
        // Small delay to ensure the canvas has its final CSS dimensions
        setTimeout(() => {
            if (globeInstance) globeInstance.pointOfView(initialPov, 0);
        }, 0);
    }

    // Auto-rotate gently
    globeInstance.controls().autoRotate = !initialPov; // Start static if coming from map
    globeInstance.controls().autoRotateSpeed = 0.4;
    globeInstance.controls().enableZoom = true;
    globeInstance.controls().minDistance = 101;
    globeInstance.controls().maxDistance = 800;

    // Pause auto-rotate during interaction, resume after 15s delay
    let resumeRotateTimer = null;
    if (!initialPov) {
        resumeRotateTimer = setTimeout(() => {
            if (globeInstance) globeInstance.controls().autoRotate = true;
        }, 15000);
    }

    globeInstance.controls().addEventListener('start', () => {
        globeInstance.controls().autoRotate = false;
        if (resumeRotateTimer) clearTimeout(resumeRotateTimer);
    });
    globeInstance.controls().addEventListener('end', () => {
        // Swap to flat map when zoomed in close enough
        const pov = globeInstance.pointOfView();
        if (pov && pov.altitude < 0.5) {
            executeViewSwap(false, pov);
            return;
        }
        // Resume auto-rotation after 15 seconds of inactivity (only if not from map)
        if (!initialPov) {
            resumeRotateTimer = setTimeout(() => {
                if (globeInstance) globeInstance.controls().autoRotate = true;
            }, 15000);
        }
    });

    // Plot locations
    updateGlobeData(!!initialPov);

    // Handle globe click (same as map click) — open modal at that position
    globeInstance.onGlobeClick(({ lat, lng }) => {
        tempClickCoords = { lat, lng };
        openModal();
    });

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
        if (globeInstance && globeContainerEl.clientWidth > 0) {
            globeInstance
                .width(globeContainerEl.clientWidth)
                .height(globeContainerEl.clientHeight);
        }
    });
    resizeObserver.observe(globeContainerEl);
}

function updateGlobeData(skipAutoFly = false) {
    if (!globeInstance) return;

    const activeLocations = locations.filter(l => !l.disabled);

    // Points = location markers — thin dots
    globeInstance
        .pointsData(activeLocations)
        .pointLat(d => d.lat)
        .pointLng(d => d.lng)
        .pointColor(() => '#00d2ff')
        .pointAltitude(0.01)
        .pointRadius(0.18)
        .pointLabel(d => `
            <div style="
                background: rgba(9,14,26,0.85);
                border: 1px solid #00d2ff;
                border-radius: 8px;
                padding: 6px 10px;
                font-family: Outfit, sans-serif;
                color: #f8fafc;
                font-size: 13px;
                white-space: nowrap;
                pointer-events: none;
            ">
                <strong style='color:#00d2ff'>${d.name}</strong>
            </div>
        `)
        .onPointClick((point) => {
            globeInstance.pointOfView({ lat: point.lat, lng: point.lng, altitude: 1.2 }, 600);
        });

    // Arcs = travel routes between consecutive active stops
    const arcs = [];
    for (let i = 0; i < activeLocations.length - 1; i++) {
        const from = activeLocations[i];
        const to = activeLocations[i + 1];
        const mode = to.travelMode || 'car';
        const color = mode === 'plane' ? '#ff0055' :
            mode === 'boat' ? '#00aaff' :
                mode === 'train' ? '#ffaa00' :
                    '#00d2ff';
        arcs.push({ startLat: from.lat, startLng: from.lng, endLat: to.lat, endLng: to.lng, color });
    }

    globeInstance
        .arcsData(arcs)
        .arcStartLat(d => d.startLat)
        .arcStartLng(d => d.startLng)
        .arcEndLat(d => d.endLat)
        .arcEndLng(d => d.endLng)
        .arcColor(d => d.color)
        .arcStroke(0.4)          // thin line
        .arcAltitude(0.04)
        .arcDashLength(1)        // solid arc
        .arcDashGap(0)
        .arcDashAnimateTime(0);  // no animation

    // Labels for location names
    globeInstance
        .labelsData(activeLocations)
        .labelLat(d => d.lat)
        .labelLng(d => d.lng)
        .labelText(d => d.name)
        .labelSize(0.5)
        .labelColor(() => '#ffffff')
        .labelAltitude(0.025)
        .labelResolution(2);

    // Fly to first location if available (only if not skipping)
    if (activeLocations.length > 0 && !skipAutoFly) {
        const first = activeLocations[0];
        globeInstance.pointOfView({ lat: first.lat, lng: first.lng, altitude: 2.5 }, 1000);
    }
}

let sortableInstance;

function setupDragAndDrop() {
    console.log('setupDragAndDrop called');
    const el = document.getElementById('itineraryList');
    if (!el) {
        console.error('itineraryList not found');
        return;
    }

    if (typeof Sortable !== 'undefined') {
        console.log('SortableJS found, creating instance');
        sortableInstance = Sortable.create(el, {
            animation: 150,
            disabled: groupingEnabled,
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

function updateSortableState() {
    if (sortableInstance) {
        sortableInstance.options.disabled = groupingEnabled;
        console.log('Sortable disabled state updated to:', groupingEnabled);
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
            ticketNumber: document.getElementById('ticketNumber').value,
            departureTime: document.getElementById('departureTime').value,

            // Stay Details
            placeToStay: document.getElementById('placeToStay').value,
            stayAddress: document.getElementById('stayAddress').value,
            stayLat: document.getElementById('stayLat').value ? parseFloat(document.getElementById('stayLat').value) : null,
            stayLng: document.getElementById('stayLng').value ? parseFloat(document.getElementById('stayLng').value) : null,
            stayDateFrom: document.getElementById('stayDateFrom').value,
            stayDateTo: document.getElementById('stayDateTo').value,
            checkoutTime: document.getElementById('checkoutTime').value,

            activities: {
                morning: document.getElementById('morningActivity').value,
                afternoon: document.getElementById('afternoonActivity').value,
                allDay: document.getElementById('allDayActivity').value
            },
            kidsActivity: document.getElementById('kidsActivity').value,
            food: {
                breakfast: document.getElementById('foodBreakfast').value,
                lunch: document.getElementById('foodLunch').value,
                dinner: document.getElementById('foodDinner').value
            },
            funFact: document.getElementById('funFact').value,
            phrases: document.getElementById('phrases').value,
            tags: document.getElementById('locationTags').value,
            stopDate: document.getElementById('stopDate').value,
            dayTrips: JSON.parse(JSON.stringify(modalDayTrips))
        };

        const existingIndex = locations.findIndex(l => l.id === id);
        if (existingIndex > -1) {
            locations[existingIndex] = newLocation;
        } else {
            locations.push(newLocation);
        }

        closeModal();
        renderApp();
        renderMapElements(); // Update map markers
        saveData();
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
    if (document.getElementById('printBtn')) {
        document.getElementById('printBtn').addEventListener('click', (e) => {
            e.preventDefault();
            if (map) {
                const center = map.getCenter();
                const originalTheme = currentTheme;
                
                // Force actual light mode for printing
                setMapTheme('light');
                renderMapElements('light'); // Re-render markers and lines with light theme colors
                document.body.classList.add('print-prep');
                
                map.invalidateSize({pan: false});
                map.setView(center, map.getZoom(), {animate: false});
                
                // Give tiles a moment to load before opening print dialog
                setTimeout(() => {
                    window.print();
                    
                    // Restore original theme and cleanup
                    setMapTheme(originalTheme);
                    renderMapElements(originalTheme); // Restore marker and line colors
                    document.body.classList.remove('print-prep');
                    map.invalidateSize();
                }, 800);
            } else {
                window.print();
            }
        });
    }

    if (document.getElementById('printFrameBtn')) {
        document.getElementById('printFrameBtn').addEventListener('click', () => {
            const mapContainer = document.querySelector('.map-container');
            if (mapContainer) {
                const isActive = mapContainer.classList.toggle('show-print-frame');
                
                // Toggle zoom sensitivity
                if (isActive) {
                    map.options.zoomSnap = 0.1;
                    map.options.zoomDelta = 0.5;
                    map.scrollWheelZoom.options.wheelPxPerZoomLevel = 120;
                } else {
                    map.options.zoomSnap = 1;
                    map.options.zoomDelta = 1;
                    map.scrollWheelZoom.options.wheelPxPerZoomLevel = 60;
                }

                // Trigger map resize so centering remains correct
                setTimeout(() => {
                    if (map) map.invalidateSize();
                }, 300);

                const iconBtn = document.getElementById('printFrameBtn');
                if (isActive) {
                    iconBtn.style.color = '#ff0055'; // highlight when active
                    iconBtn.title = "Exit Print Preview";
                } else {
                    iconBtn.style.color = '';
                    iconBtn.title = "Toggle Print Preview Frame";
                }
            }
        });
    }

    window.addEventListener('beforeprint', () => {
        const dateSpan = document.getElementById('printDateValue');
        if (dateSpan) {
            const today = new Date();
            dateSpan.textContent = today.toLocaleDateString();
        }
        if (map) {
            map.invalidateSize();
        }
    });

    window.addEventListener('afterprint', () => {
        if (map) map.invalidateSize();
    });

    // Settings Modal Logic
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsModal = document.getElementById('settingsModal');
    const closeSettingsModal = document.getElementById('closeSettingsModal');

    // Wire up modal buttons
    const modalExportBtn = document.getElementById('modalExportBtn');
    const modalImportBtn = document.getElementById('modalImportBtn');
    const modalImportRestaurantsBtn = document.getElementById('modalImportRestaurantsBtn');
    const modalResetBtn = document.getElementById('modalResetBtn');
    const toggleRestaurants = document.getElementById('toggleRestaurants');
    const toggleSupermarkets = document.getElementById('toggleSupermarkets');

    if (settingsBtn && settingsModal) {
        settingsBtn.addEventListener('click', () => {
            settingsModal.classList.add('active');
            // Sync toggle states
            if (toggleRestaurants) toggleRestaurants.checked = showRestaurants;
            if (toggleSupermarkets) toggleSupermarkets.checked = showSupermarkets;
            const toggleGlobe = document.getElementById('toggleGlobeView');
            if (toggleGlobe) toggleGlobe.checked = globeView;

            // Sync Settings UI
            if (document.getElementById('syncEnabled')) document.getElementById('syncEnabled').checked = syncEnabled;
            if (document.getElementById('autoSync')) document.getElementById('autoSync').checked = autoSync;
            if (document.getElementById('syncUrl')) document.getElementById('syncUrl').value = syncUrl;
            if (document.getElementById('kmlFileName')) document.getElementById('kmlFileName').value = kmlFileName;
            if (document.getElementById('csvFileName')) document.getElementById('csvFileName').value = csvFileName;
            if (document.getElementById('syncUsername')) document.getElementById('syncUsername').value = syncUsername;
            if (document.getElementById('syncPassword')) document.getElementById('syncPassword').value = syncPassword;
            if (document.getElementById('syncStatus')) document.getElementById('syncStatus').innerText = `Status: ${syncEnabled ? 'Ready (Last: ' + lastSyncTime + ')' : 'Local Mode'}`;
        });

        if (closeSettingsModal) {
            closeSettingsModal.addEventListener('click', () => {
                settingsModal.classList.remove('active');
            });
        }

        // Close on outside click
        settingsModal.addEventListener('click', (e) => {
            if (e.target === settingsModal) settingsModal.classList.remove('active');
        });

        // Settings Actions
        if (modalExportBtn) modalExportBtn.addEventListener('click', exportItinerary);

        if (modalImportBtn && importFile) {
            modalImportBtn.addEventListener('click', () => importFile.click());
        }

        if (modalImportRestaurantsBtn && importRestaurantsFile) {
            modalImportRestaurantsBtn.addEventListener('click', () => importRestaurantsFile.click());
        }

        if (modalResetBtn) {
            modalResetBtn.addEventListener('click', () => {
                if (confirm('Are you sure you want to clear your itinerary and all imported restaurants? This cannot be undone.')) {
                    locations = [];
                    // Clear restaurants
                    restaurantMarkers.forEach(m => map.removeLayer(m));
                    restaurantMarkers = [];
                    // Clear supermarkets
                    supermarketMarkers.forEach(m => map.removeLayer(m));
                    supermarketMarkers = [];
                    // Clear geocode queue
                    geocodeQueue.length = 0;

                    renderApp();
                    renderMapElements();
                    saveData();
                    settingsModal.classList.remove('active');
                }
            });
        }

        // Toggle Switch
        if (toggleRestaurants) {
            toggleRestaurants.addEventListener('change', (e) => {
                toggleRestaurantsVisibility(e.target.checked);
            });
        }

        if (toggleSupermarkets) {
            toggleSupermarkets.addEventListener('change', (e) => {
                toggleSupermarketsVisibility(e.target.checked);
            });
        }

        const toggleGlobe = document.getElementById('toggleGlobeView');
        if (toggleGlobe) {
            toggleGlobe.checked = globeView;
            toggleGlobe.addEventListener('change', (e) => {
                toggleGlobeView(e.target.checked);
            });
        }

        // Sync Event Listeners
        if (document.getElementById('syncEnabled')) {
            document.getElementById('syncEnabled').addEventListener('change', (e) => {
                syncEnabled = e.target.checked;
                saveData();
            });
        }
        if (document.getElementById('autoSync')) {
            document.getElementById('autoSync').addEventListener('change', (e) => {
                autoSync = e.target.checked;
                saveData();
            });
        }
        if (document.getElementById('syncUrl')) {
            document.getElementById('syncUrl').addEventListener('input', (e) => {
                syncUrl = e.target.value;
                saveData();
            });
        }
        if (document.getElementById('kmlFileName')) {
            document.getElementById('kmlFileName').addEventListener('input', (e) => {
                kmlFileName = e.target.value;
                saveData();
            });
        }
        if (document.getElementById('csvFileName')) {
            document.getElementById('csvFileName').addEventListener('input', (e) => {
                csvFileName = e.target.value;
                saveData();
            });
        }
        if (document.getElementById('syncUsername')) {
            document.getElementById('syncUsername').addEventListener('input', (e) => {
                syncUsername = e.target.value;
                saveData();
            });
        }
        if (document.getElementById('syncPassword')) {
            document.getElementById('syncPassword').addEventListener('input', (e) => {
                syncPassword = e.target.value;
                saveData();
            });
        }

        // Sync Action Buttons
        if (document.getElementById('pullKmlBtn')) document.getElementById('pullKmlBtn').addEventListener('click', () => syncKML('pull'));
        if (document.getElementById('pushKmlBtn')) document.getElementById('pushKmlBtn').addEventListener('click', () => syncKML('push'));
        if (document.getElementById('pullCsvBtn')) document.getElementById('pullCsvBtn').addEventListener('click', () => syncCSV('pull'));
        if (document.getElementById('pushCsvBtn')) document.getElementById('pushCsvBtn').addEventListener('click', () => syncCSV('push'));
    }

    // Settings File Inputs
    if (importFile) {
        importFile.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                importItinerary(e);
                settingsModal.classList.remove('active');
            }
        });
    }

    if (importRestaurantsFile) {
        importRestaurantsFile.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                importRestaurants(e);
                settingsModal.classList.remove('active');
            }
        });
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

    // Tags Input Listener for Suggestions Sync
    const locationTagsInput = document.getElementById('locationTags');
    if (locationTagsInput) {
        locationTagsInput.addEventListener('input', () => {
            updateTagSuggestions();
        });
    }

    // Check-in/Check-out date validation and nights calculation
    const stayDateFrom = document.getElementById('stayDateFrom');
    const stayDateTo = document.getElementById('stayDateTo');
    const stayNightsDisplay = document.getElementById('stayNightsDisplay');
    const stayNightsCount = document.getElementById('stayNightsCount');

    function updateNightsDisplay() {
        if (stayDateFrom.value && stayDateTo.value) {
            const checkIn = new Date(stayDateFrom.value);
            const checkOut = new Date(stayDateTo.value);
            const nights = Math.round((checkOut - checkIn) / (1000 * 60 * 60 * 24));

            if (nights > 0) {
                stayNightsCount.textContent = nights;
                stayNightsDisplay.style.display = 'flex';
            } else {
                stayNightsDisplay.style.display = 'none';
            }
        } else {
            stayNightsDisplay.style.display = 'none';
        }
    }

    if (stayDateFrom && stayDateTo) {
        stayDateFrom.addEventListener('change', () => {
            if (stayDateFrom.value) {
                // Set minimum checkout date to the day after check-in
                const checkInDate = new Date(stayDateFrom.value);
                checkInDate.setDate(checkInDate.getDate() + 1);
                const minCheckout = checkInDate.toISOString().split('T')[0];
                stayDateTo.min = minCheckout;

                // If current checkout is before or same as check-in, clear it
                if (stayDateTo.value && stayDateTo.value <= stayDateFrom.value) {
                    stayDateTo.value = minCheckout;
                }
            }
            updateNightsDisplay();
        });

        stayDateTo.addEventListener('change', updateNightsDisplay);
    }

    // Stay Address Search Listener
    const stayAddressInput = document.getElementById('stayAddress');
    if (stayAddressInput) {
        stayAddressInput.addEventListener('input', debounce((e) => {
            const query = e.target.value.trim();
            if (query.length > 2) {
                // Show loading state
                const searchIcon = stayAddressInput.parentElement.querySelector('i');
                if (searchIcon) searchIcon.className = 'fa-solid fa-spinner fa-spin';

                // Use Nominatim API for geocoding
                fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`)
                    .then(response => response.json())
                    .then(data => {
                        // Reset icon
                        if (searchIcon) searchIcon.className = 'fa-solid fa-magnifying-glass';

                        if (data && data.length > 0) {
                            const result = data[0];
                            document.getElementById('stayLat').value = parseFloat(result.lat).toFixed(4);
                            document.getElementById('stayLng').value = parseFloat(result.lon).toFixed(4);
                        }
                    })
                    .catch(() => {
                        if (searchIcon) searchIcon.className = 'fa-solid fa-triangle-exclamation';
                    });
            }
        }, 1500));
    }

    // Settings Modal Sync UI Initialization
    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            document.getElementById('autoSync').checked = autoSync;
            if (typeof updateFileStatusUI === 'function') {
                updateFileStatusUI();
            }
        });
    }

    const linkKmlBtn = document.getElementById('linkKmlBtn');
    if (linkKmlBtn) linkKmlBtn.addEventListener('click', () => linkFile('kml'));

    const linkCsvBtn = document.getElementById('linkCsvBtn');
    if (linkCsvBtn) linkCsvBtn.addEventListener('click', () => linkFile('csv'));

    // verifyFileAccessBtn is dynamically created inside fileStatusContainer
    const statusContainer = document.getElementById('fileStatusContainer');
    if (statusContainer) {
        statusContainer.addEventListener('click', (e) => {
            if (e.target && e.target.id === 'verifyFileAccessBtn') {
                verifyAccess();
            }
        });
    }
}

// Helper Functions
function editLocation(id) {
    openModal(id);
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
