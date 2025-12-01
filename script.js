// State Management
let locations = JSON.parse(localStorage.getItem('wanderlust_locations')) || [];
let map;
let markers = [];
let polyline;
let tempClickCoords = null;

// DOM Elements
const locationModal = document.getElementById('locationModal');
const locationForm = document.getElementById('locationForm');
const itineraryList = document.getElementById('itineraryList');
const locationCount = document.getElementById('locationCount');
const resetBtn = document.getElementById('resetBtn');
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
    map = L.map('map').setView([48.8566, 2.3522], 5);

    // Dark/Modern Map Tiles (CartoDB Dark Matter)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">Open Street Map</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(map);

    // Map Click Handler
    map.on('click', (e) => {
        tempClickCoords = e.latlng;
        openModal();
    });
}

// Render App (Map Markers + Itinerary Cards)
function renderApp() {
    renderMapElements();
    renderItineraryList();
    updateStats();
}

// Render Map Elements (Markers & Polyline)
function renderMapElements() {
    // Clear existing
    markers.forEach(marker => map.removeLayer(marker));
    markers = [];
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

        const marker = L.marker([loc.lat, loc.lng], { icon: customIcon })
            .addTo(map)
            .bindPopup(`
                <div style="font-family: 'Outfit', sans-serif; color: #0f172a; text-align: center;">
                    <h3 style="margin: 0 0 5px 0; color: #00d2ff;">${loc.name}</h3>
                    <p style="margin: 0;">${loc.activities.morning || loc.activities.afternoon || loc.activities.allDay || 'No activities set'}</p>
                </div>
            `);

        markers.push(marker);
    });

    // Draw Polyline
    if (locations.length > 1) {
        const latlngs = locations.map(loc => [loc.lat, loc.lng]);
        polyline = L.polyline(latlngs, {
            color: '#00d2ff',
            weight: 3,
            opacity: 0.7,
            dashArray: '10, 10',
            lineCap: 'round'
        }).addTo(map);
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

        // Add click handler to toggle expanded state
        card.addEventListener('click', function (e) {
            // Don't toggle if clicking on action buttons
            if (e.target.closest('.card-action-btn')) return;
            this.classList.toggle('expanded');
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
    localStorage.setItem('wanderlust_locations', JSON.stringify(locations));
}

// Export/Import Functions
function exportItinerary() {
    const dataStr = JSON.stringify(locations, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'wanderlust_itinerary.json';
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
            if (Array.isArray(importedData)) {
                if (confirm('Importing will replace your current itinerary. Continue?')) {
                    locations = importedData;
                    renderApp();
                    saveData();
                    alert('Itinerary imported successfully!');
                }
            } else {
                alert('Invalid file format: Data must be an array of locations.');
            }
        } catch (error) {
            console.error('Import Error:', error);
            alert('Error importing file. Please make sure it is a valid JSON file.');
        }
        // Reset input
        event.target.value = '';
    };
    reader.readAsText(file);
}
