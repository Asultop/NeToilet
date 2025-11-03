// Data storage
let buildingList = []
let linkerData = []
let csData = []
const currentSelection = {
  campus: "",
  building: "",
  floor: "",
  restroom: null,
}
let userLocation = null
let pendingNearestRestroom = null // used when inside a building to remember the closest restroom
// Map related
let map = null
let markersLayer = null
let userMarker = null
let userCentered = false // whether we've centered the map on user yet
let selectedBuildingForModal = null
let pendingMatchedRestroom = null
let matchPending = false

// DOM Elements
const campusSelect = document.getElementById("campusSelect")
const buildingSelect = document.getElementById("buildingSelect")
const floorSelect = document.getElementById("floorSelect")
const restroomType = document.getElementById("restroomType")
const locationShort = document.getElementById("locationShort")
const roomNumber = document.getElementById("roomNumber")
const locationDesc = document.getElementById("locationDesc")
const coordinates = document.getElementById("coordinates") // Added coordinates element
const notes = document.getElementById("notes")
const restroomsList = document.getElementById("restroomsList")
const restroomsCount = document.getElementById("restroomsCount")
const chooseRestroomModal = document.getElementById("chooseRestroomModal")
const chooseRestroomList = document.getElementById("chooseRestroomList")
const cancelChooseRestroom = document.getElementById("cancelChooseRestroom")
const locationModal = document.getElementById("locationModal")
const floorModal = document.getElementById("floorModal")
const manualFloorSelect = document.getElementById("manualFloorSelect")
const debugLatitude = document.getElementById("debugLatitude")
const debugLongitude = document.getElementById("debugLongitude")
const themeToggle = document.getElementById("themeToggle")
const noRestroomModal = document.getElementById("noRestroomModal")

// Initialize app
async function init() {
  console.log("[Asul] Initializing app...")
  await loadData()
  // Initialize map and add building markers (use linkerData)
  initMap()
  addBuildingMarkersToMap()
  setupEventListeners()
  initializeTheme()
  requestLocationPermission()
}

// Initialize theme
function initializeTheme() {
  const savedTheme = localStorage.getItem("theme")
  if (savedTheme) {
    document.body.className = savedTheme
  } else {
    // Use system preference if no saved theme
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches
    document.body.className = prefersDark ? "dark-theme" : "light-theme"
  }
}

function toggleTheme() {
  const currentTheme = document.body.className
  const newTheme = currentTheme === "light-theme" ? "dark-theme" : "light-theme"
  document.body.className = newTheme
  localStorage.setItem("theme", newTheme)
}

function updateDebugInfo() {
  if (userLocation) {
    debugLatitude.textContent = userLocation.latitude.toFixed(6)
    debugLongitude.textContent = userLocation.longitude.toFixed(6)
  } else {
    debugLatitude.textContent = "-"
    debugLongitude.textContent = "-"
  }
}

// Load data from JSON files
async function loadData() {
  try {
    const [buildings, linker, cs] = await Promise.all([
      fetch("data/buildingList.json").then((r) => r.json()),
      fetch("data/linker.json").then((r) => r.json()),
      fetch("data/cs.json").then((r) => r.json()),
    ])

    buildingList = buildings
    linkerData = linker
    csData = cs

    console.log("[Asul] Data loaded successfully")
    populateCampusSelect()
    // ensure combo boxes reflect loaded data
    syncComboBoxes()
  } catch (error) {
    console.error("[Asul] Error loading data:", error)
  }
}

// Populate campus dropdown
function populateCampusSelect() {
  campusSelect.innerHTML = '<option value="">选择校区</option>'
  buildingList.forEach((item) => {
    const option = document.createElement("option")
    option.value = item.校区
    option.textContent = item.校区
    campusSelect.appendChild(option)
  })
}

// Populate building dropdown based on campus
function populateBuildingSelect(campus) {
  buildingSelect.innerHTML = '<option value="">选择楼宇</option>'
  const campusData = buildingList.find((item) => item.校区 === campus)
  if (campusData) {
    campusData.楼宇.forEach((building) => {
      const option = document.createElement("option")
      option.value = building
      option.textContent = building
      buildingSelect.appendChild(option)
    })
  }
}

// Sync all combo boxes (campus/building/floor/manualFloor) to currentSelection
function syncComboBoxes() {
  // Ensure campus options exist
  if (!campusSelect.querySelector('option')) populateCampusSelect()

  // Set campus value
  campusSelect.value = currentSelection.campus || ""

  // Ensure building options match campus
  if (currentSelection.campus) {
    populateBuildingSelect(currentSelection.campus)
  }
  buildingSelect.value = currentSelection.building || ""

  // Ensure floor options match building
  if (currentSelection.building) {
    populateFloorSelect(currentSelection.building)
  }
  // floorSelect expects numeric value or empty
  floorSelect.value = currentSelection.floor ? String(currentSelection.floor) : ""

  // manualFloorSelect mirrors floorSelect for the modal
  if (currentSelection.building) {
    // repopulate manualFloorSelect to match building
    manualFloorSelect.innerHTML = '<option value="">选择楼层</option>'
    const buildingData = linkerData.find((item) => item.楼宇 === currentSelection.building)
    if (buildingData) {
      for (let i = 1; i <= buildingData.总楼层数; i++) {
        const option = document.createElement("option")
        option.value = i
        option.textContent = `${i}楼`
        manualFloorSelect.appendChild(option)
      }
    }
  }
  manualFloorSelect.value = currentSelection.floor ? String(currentSelection.floor) : ""
}

// Populate floor dropdown based on building
function populateFloorSelect(building) {
  floorSelect.innerHTML = '<option value="">选择楼层</option>'
  const buildingData = linkerData.find((item) => item.楼宇 === building)
  if (buildingData) {
    for (let i = 1; i <= buildingData.总楼层数; i++) {
      const option = document.createElement("option")
      option.value = i
      option.textContent = `${i}楼`
      floorSelect.appendChild(option)
    }
  }
}

// Setup event listeners
function setupEventListeners() {
  campusSelect.addEventListener("change", (e) => {
    const val = e.target.value
    // Always update currentSelection.campus
    currentSelection.campus = val || ""

    if (!val) {
      // Campus cleared: clear building and floor to defaults
      currentSelection.building = ""
      currentSelection.floor = null
      buildingSelect.innerHTML = '<option value="">选择楼宇</option>'
      floorSelect.innerHTML = '<option value="">选择楼层</option>'
      syncComboBoxes()
      updateRestroomDisplay()
      return
    }

    // New campus selected: populate buildings, clear downstream selections
    populateBuildingSelect(val)
    currentSelection.building = ""
    currentSelection.floor = null
    buildingSelect.value = ""
    floorSelect.innerHTML = '<option value="">选择楼层</option>'
    syncComboBoxes()
    updateRestroomDisplay()
  })

  buildingSelect.addEventListener("change", (e) => {
    const val = e.target.value
    currentSelection.building = val || ""

    if (!val) {
      // Building cleared: reset floor to default
      currentSelection.floor = null
      floorSelect.innerHTML = '<option value="">选择楼层</option>'
      syncComboBoxes()
      updateRestroomDisplay()
      return
    }

    // Building selected: populate floors and clear current floor selection
    populateFloorSelect(val)
    currentSelection.floor = null
    floorSelect.value = ""
    syncComboBoxes()
    updateRestroomDisplay()
  })

  floorSelect.addEventListener("change", (e) => {
    const val = Number.parseInt(e.target.value)
    currentSelection.floor = Number.isNaN(val) ? null : val
    // First update display
    updateRestroomDisplay()

    // If campus and building are selected, check if this floor has multiple restroom entries
    if (currentSelection.campus && currentSelection.building && currentSelection.floor) {
      const matches = csData.filter((r) => r.校区 === currentSelection.campus && r.楼宇 === currentSelection.building && r.楼层 === currentSelection.floor)
      if (matches.length > 1) {
        // populate choose modal
        if (chooseRestroomList) chooseRestroomList.innerHTML = ""
        matches.forEach((m) => {
          const b = document.createElement("button")
          b.className = "choose-btn"
          b.textContent = `${m.卫生间属性}${m.附近的房间号 ? ' · ' + m.附近的房间号 : ''}`
          b.addEventListener("click", () => {
            selectRestroom(m)
            if (chooseRestroomModal) chooseRestroomModal.classList.remove("show")
            if (chooseRestroomList) chooseRestroomList.innerHTML = ""
          })
          if (chooseRestroomList) chooseRestroomList.appendChild(b)
        })
        if (chooseRestroomModal) chooseRestroomModal.classList.add("show")
      } else if (matches.length === 1) {
        // auto-select the single restroom on that floor
        selectRestroom(matches[0])
      }
    }
  })

  document.getElementById("allowLocation").addEventListener("click", () => {
    startLocating()
  })

  document.getElementById("denyLocation").addEventListener("click", () => {
    locationModal.classList.remove("show")
    manualSelection()
    updateRestroomDisplay()
  })

  document.getElementById("confirmFloor").addEventListener("click", () => {
    const selectedFloor = Number.parseInt(manualFloorSelect.value)
    const confirmBtn = document.getElementById("confirmFloor")
    const fm = document.getElementById("floorMatchResult")
    const fmMsg = document.getElementById("floorMatchMessage")
    const fmDetails = document.getElementById("floorMatchDetails")
    if (!selectedFloor) return

    // If we are in a pending match state, proceed to the matched restroom
    if (matchPending && pendingMatchedRestroom) {
      selectRestroom(pendingMatchedRestroom)
      pendingMatchedRestroom = null
      matchPending = false
      if (fm) fm.style.display = "none"
      if (confirmBtn) confirmBtn.textContent = "确认"
      floorModal.classList.remove("show")
      syncComboBoxes()
      renderRestroomsList()
      return
    }

    // Normal flow: try to find restroom on selected floor within the selected building
    currentSelection.floor = selectedFloor
    const restroomsOnFloor = csData.filter((r) => r.楼宇 === currentSelection.building && r.楼层 === selectedFloor)

    if (restroomsOnFloor.length > 0) {
      // choose nearest by geographic distance if possible
      if (userLocation && restroomsOnFloor.some((r) => Number.isFinite(r.经度) && Number.isFinite(r.纬度))) {
        let nearest = restroomsOnFloor[0]
        let minDist = Number.POSITIVE_INFINITY
        restroomsOnFloor.forEach((r) => {
          if (Number.isFinite(r.经度) && Number.isFinite(r.纬度)) {
            const d = calculateDistance(userLocation.latitude, userLocation.longitude, r.纬度, r.经度)
            if (d < minDist) {
              minDist = d
              nearest = r
            }
          }
        })
        selectRestroom(nearest)
      } else {
        // fallback: pick first
        selectRestroom(restroomsOnFloor[0])
      }

      floorModal.classList.remove("show")
      syncComboBoxes()
      renderRestroomsList()
      return
    }

    // No restroom on this floor -> find nearest-by-floor restroom within the same building
    const restroomsInBuilding = csData.filter((r) => r.楼宇 === currentSelection.building)
    if (restroomsInBuilding.length === 0) {
      // No restrooms at all in this building
      currentSelection.restroom = null
      clearDetailsCard()
      floorModal.classList.remove("show")
      noRestroomModal.classList.add("show")
      return
    }

    // Find by minimal floor difference, tie-breaker by geographic distance
    let candidate = restroomsInBuilding[0]
    let bestFloorDiff = Math.abs(candidate.楼层 - selectedFloor)
    for (const r of restroomsInBuilding) {
      const diff = Math.abs(r.楼层 - selectedFloor)
      if (diff < bestFloorDiff) {
        candidate = r
        bestFloorDiff = diff
      } else if (diff === bestFloorDiff && userLocation && Number.isFinite(r.经度) && Number.isFinite(r.纬度) && Number.isFinite(candidate.经度) && Number.isFinite(candidate.纬度)) {
        const d1 = calculateDistance(userLocation.latitude, userLocation.longitude, r.纬度, r.经度)
        const d2 = calculateDistance(userLocation.latitude, userLocation.longitude, candidate.纬度, candidate.经度)
        if (d1 < d2) candidate = r
      }
    }

    // Prepare match UI in the modal
    pendingMatchedRestroom = candidate
    matchPending = true
    if (fm) fm.style.display = "block"
    if (fmMsg) fmMsg.textContent = "当前楼层无卫生间，已为您匹配到当前最近的卫生间"
    // Show details: 校区 楼宇 楼层 厕所信息 距离您多少米，并显示层数差和方向
    let distanceText = "未知"
    if (userLocation && Number.isFinite(candidate.经度) && Number.isFinite(candidate.纬度)) {
      const d = Math.round(calculateDistance(userLocation.latitude, userLocation.longitude, candidate.纬度, candidate.经度))
      distanceText = `${d}M`
    }
    // floor diff and direction
    const floorDiff = candidate.楼层 - selectedFloor
    let floorDirectionText = ""
    if (floorDiff > 0) floorDirectionText = `向上 ${floorDiff} 层`
    else if (floorDiff < 0) floorDirectionText = `向下 ${Math.abs(floorDiff)} 层`
    else floorDirectionText = `同层`

    if (fmDetails)
      fmDetails.textContent = `${candidate.校区 || "-"} · ${candidate.楼宇 || "-"} · ${candidate.楼层 || "-"}楼 · ${candidate.卫生间属性 || "-"} · 距离您 ${distanceText} · ${floorDirectionText}`
    if (confirmBtn) confirmBtn.textContent = "前往匹配厕所"
    // keep modal open for user to confirm
    return
  })

  document.getElementById("confirmNoRestroom").addEventListener("click", () => {
    noRestroomModal.classList.remove("show")
  })

  // choose restroom modal cancel
  if (cancelChooseRestroom) {
    cancelChooseRestroom.addEventListener("click", () => {
      if (chooseRestroomModal) chooseRestroomModal.classList.remove("show")
      if (chooseRestroomList) chooseRestroomList.innerHTML = ""
    })
  }

  themeToggle.addEventListener("click", toggleTheme)
}

// Request location permission
function requestLocationPermission() {
  // Ensure permission state visible and locating state hidden when asking
  const perm = document.getElementById("permissionState")
  const locating = document.getElementById("locatingState")
  if (perm) perm.style.display = "block"
  if (locating) locating.style.display = "none"
  locationModal.classList.add("show")
}

// Get user location
function getUserLocation() {
  console.log("[Asul] Requesting geolocation...")
  if ("geolocation" in navigator) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        userLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          altitude: position.coords.altitude,
        }
        console.log("[Asul] Location obtained:", userLocation)
        updateDebugInfo()
        findNearestRestroom()
        // show user location on the map (red dot)
        try {
          updateUserMarker()
        } catch (e) {
          console.warn("[Asul] updateUserMarker error:", e)
        }
        // Close locating UI and modal shortly after success
        const perm = document.getElementById("permissionState")
        const locating = document.getElementById("locatingState")
        setTimeout(() => {
          if (locating) locating.style.display = "none"
          if (perm) perm.style.display = "block"
          locationModal.classList.remove("show")
        }, 600)
      },
      (error) => {
        console.error("[Asul] Geolocation error:", error)
        updateDebugInfo()
        // Restore modal state and fallback to manual selection
        const perm = document.getElementById("permissionState")
        const locating = document.getElementById("locatingState")
        if (locating) locating.style.display = "none"
        if (perm) perm.style.display = "block"
        locationModal.classList.remove("show")
        manualSelection()
        updateRestroomDisplay()
      },
      { enableHighAccuracy: true },
    )
  } else {
    console.log("[Asul] Geolocation not supported")
    manualSelection()
    updateRestroomDisplay()
  }
}

// Start locating: show locating state inside permission modal and trigger geolocation
function startLocating() {
  const perm = document.getElementById("permissionState")
  const locating = document.getElementById("locatingState")
  if (perm) perm.style.display = "none"
  if (locating) locating.style.display = "block"
  // Ensure modal remains visible while locating
  if (!locationModal.classList.contains("show")) locationModal.classList.add("show")
  getUserLocation()
}

// Find nearest restroom based on location
function findNearestRestroom() {
  if (!userLocation) return

  let nearestBuilding = null
  let minDistance = Number.POSITIVE_INFINITY

  // Find nearest building
  linkerData.forEach((building) => {
    // parse "中心经纬度" robustly (可能包含空格) —— 格式为 "纬度,经度"
    const parts = String(building.中心经纬度 || "").split(",")
    const lng = parts[0] ? Number(parts[0].trim()) : NaN
    const lat = parts[1] ? Number(parts[1].trim()) : NaN
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return

    const distance = calculateDistance(userLocation.latitude, userLocation.longitude, lat, lng)

    if (distance < minDistance) {
      minDistance = distance
      nearestBuilding = building
    }
  })

  if (nearestBuilding) {
    console.log("[Asul] Nearest building:", nearestBuilding.楼宇)

    // Check if user is inside the building (within radius)
    // parse center coordinates robustly
    const centerParts = String(nearestBuilding.中心经纬度 || "").split(",")
    const centerLat = centerParts[0] ? Number(centerParts[0].trim()) : NaN
    const centerLng = centerParts[1] ? Number(centerParts[1].trim()) : NaN
    let distanceToBuilding = Number.POSITIVE_INFINITY
    if (Number.isFinite(centerLat) && Number.isFinite(centerLng)) {
      distanceToBuilding = calculateDistance(userLocation.latitude, userLocation.longitude, centerLat, centerLng)
    }
    const isInsideBuilding = distanceToBuilding <= nearestBuilding.半径

    // Find campus for this building
    for (const campus of buildingList) {
      if (campus.楼宇.includes(nearestBuilding.楼宇)) {
        currentSelection.campus = campus.校区
        campusSelect.value = campus.校区
        populateBuildingSelect(campus.校区)
        break
      }
    }

    currentSelection.building = nearestBuilding.楼宇
    buildingSelect.value = nearestBuilding.楼宇
    populateFloorSelect(nearestBuilding.楼宇)

    // Compute nearest restroom within this building (if any positional data available)
    const restroomsInBuilding = csData.filter((r) => r.楼宇 === nearestBuilding.楼宇)
    let nearestRestroom = null
    if (restroomsInBuilding.length > 0 && userLocation) {
      let minDist = Number.POSITIVE_INFINITY
      restroomsInBuilding.forEach((r) => {
        // allow coordinates equal to 0; use Number.isFinite to validate numeric coords
        if (Number.isFinite(r.经度) && Number.isFinite(r.纬度)) {
          const d = calculateDistance(userLocation.latitude, userLocation.longitude, r.纬度, r.经度)
          if (d < minDist) {
            minDist = d
            nearestRestroom = r
          }
        }
      })
    }

    if (isInsideBuilding) {
      // User is inside the building -> ask for floor selection
      // Save the nearest restroom for use after floor selection
      pendingNearestRestroom = nearestRestroom
        showFloorSelectionModal(nearestBuilding)
        // keep combo boxes in sync (modal will show manualFloorSelect)
        syncComboBoxes()
    } else {
      // User is outside building -> show restrooms for this building and select nearest if found
      // Set campus and building selection, but do not force a floor selection so we can display all
      showRestroomsForBuilding(nearestBuilding, nearestRestroom)
    }
  } else {
    // No building found, default to floor 1
    currentSelection.floor = 1
    updateRestroomDisplay()
  }
}

// Show restrooms filtered to the given building and highlight nearestRestroom (if provided)
function showRestroomsForBuilding(buildingObj, nearestRestroom) {
  // Set campus
  for (const campus of buildingList) {
    if (campus.楼宇.includes(buildingObj.楼宇)) {
      currentSelection.campus = campus.校区
      campusSelect.value = campus.校区
      populateBuildingSelect(campus.校区)
      break
    }
  }

  currentSelection.building = buildingObj.楼宇
  buildingSelect.value = buildingObj.楼宇
  // Clear floor selection to show all floors within building
  // If we have a nearestRestroom, set floorSelect to that restroom's floor, otherwise clear
  if (nearestRestroom && nearestRestroom.楼层) {
    currentSelection.floor = nearestRestroom.楼层
  } else {
    currentSelection.floor = null
  }
  floorSelect.innerHTML = '<option value="">选择楼层</option>'
  populateFloorSelect(buildingObj.楼宇)
  floorSelect.value = currentSelection.floor ? String(currentSelection.floor) : ""

  if (nearestRestroom) {
    currentSelection.restroom = nearestRestroom
    updateDetailsCard(nearestRestroom)
  } else {
    currentSelection.restroom = null
    clearDetailsCard()
  }

  // Render the list filtered by currentSelection (which now has building but no floor)
  renderRestroomsList()
  // ensure all combo boxes reflect selection
  syncComboBoxes()
}

// Show floor selection modal
function showFloorSelectionModal(building) {
  manualFloorSelect.innerHTML = '<option value="">选择楼层</option>'
  for (let i = 1; i <= building.总楼层数; i++) {
    const option = document.createElement("option")
    option.value = i
    option.textContent = `${i}楼`
    manualFloorSelect.appendChild(option)
  }
  // If we have a pending nearest restroom, pre-select its floor in the modal
  if (pendingNearestRestroom && pendingNearestRestroom.楼层) {
    manualFloorSelect.value = String(pendingNearestRestroom.楼层)
  } else {
    manualFloorSelect.value = ""
  }
  // reset match UI
  const fm = document.getElementById("floorMatchResult")
  const fmMsg = document.getElementById("floorMatchMessage")
  const fmDetails = document.getElementById("floorMatchDetails")
  if (fm) fm.style.display = "none"
  if (fmMsg) fmMsg.textContent = ""
  if (fmDetails) fmDetails.textContent = ""
  // reset confirm button
  const confirmBtn = document.getElementById("confirmFloor")
  if (confirmBtn) confirmBtn.textContent = "确认"
  matchPending = false

  // Prepare initial building summary so the modal's lower result area shows association immediately
  const restroomsInBuilding = csData.filter((r) => r.楼宇 === building.楼宇)
  if (fm && fmMsg && fmDetails) {
    if (restroomsInBuilding.length === 0) {
      fm.style.display = "block"
      fmMsg.textContent = "该楼宇暂无已记录的卫生间"
      fmDetails.textContent = `${currentSelection.campus || '-'} · ${building.楼宇} · -楼 · 无可用卫生间` 
    } else {
      // compute nearest restroom in this building (by distance) if userLocation exists
      let nearest = restroomsInBuilding[0]
      if (userLocation && restroomsInBuilding.some(r => Number.isFinite(r.经度) && Number.isFinite(r.纬度))) {
        let minDist = Number.POSITIVE_INFINITY
        restroomsInBuilding.forEach((r) => {
          if (Number.isFinite(r.经度) && Number.isFinite(r.纬度)) {
            const d = calculateDistance(userLocation.latitude, userLocation.longitude, r.纬度, r.经度)
            if (d < minDist) { minDist = d; nearest = r }
          }
        })
        fm.style.display = "block"
        fmMsg.textContent = `该楼宇共有 ${restroomsInBuilding.length} 个卫生间，最近的在 ${nearest.楼层} 楼` 
        const distText = Number.isFinite(minDist) ? `${Math.round(minDist)}M` : '未知'
        fmDetails.textContent = `${currentSelection.campus || '-'} · ${building.楼宇} · ${nearest.楼层}楼 · ${nearest.卫生间属性 || '-'} · 距离您 ${distText}`
      } else {
        // No user location or coords: show count and example
        fm.style.display = "block"
        fmMsg.textContent = `该楼宇共有 ${restroomsInBuilding.length} 个卫生间` 
        fmDetails.textContent = `${currentSelection.campus || '-'} · ${building.楼宇} · ${restroomsInBuilding[0].楼层}楼 · ${restroomsInBuilding[0].卫生间属性 || '-'} · 距离您 未知`
      }
    }
  }

  floorModal.classList.add("show")
}

// Manual selection fallback
function manualSelection() {
  console.log("[Asul] Using manual selection")
  if (buildingList.length > 0) {
    currentSelection.campus = buildingList[0].校区
    campusSelect.value = buildingList[0].校区
    populateBuildingSelect(buildingList[0].校区)
    // sync all combo boxes to reflect this manual selection
    syncComboBoxes()
  }
}

// Calculate distance between two coordinates (Haversine formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3 // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lon2 - lon1) * Math.PI) / 180

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return R * c
}

// Initialize Leaflet map
function initMap() {
  try {
    // determine initial center: use first linkerData center if available
    let center = [31.0, 121.0] // fallback lat,lng (reasonable default)
    if (linkerData && linkerData.length > 0) {
      // try parse first valid 中心经纬度
      for (const b of linkerData) {
        if (b.中心经纬度) {
          const parts = String(b.中心经纬度).split(",")
          const lng = Number(parts[0] && parts[0].trim())
          const lat = Number(parts[1] && parts[1].trim())
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            center = [lat, lng]
            break
          }
        }
      }
    }

    // create map
    if (!map && typeof L !== "undefined") {
      map = L.map("map", { zoomControl: true })
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map)
      map.setView(center, 16)

      markersLayer = L.layerGroup().addTo(map)
    }
  } catch (e) {
    console.warn("[Asul] initMap failed:", e)
  }
}

// Add all restroom markers from csData
// Add building markers and scope circles from linkerData
function addBuildingMarkersToMap() {
  if (!map || !markersLayer) return
  clearMapMarkers()
  linkerData.forEach((b) => {
    try {
      // parse center lat,lng from 中心经纬度 (format: "lat,lng")
      const parts = String(b.中心经纬度 || "").split(",")
      const lng = Number(parts[0] && parts[0].trim())
      const lat = Number(parts[1] && parts[1].trim())
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return

      // create a custom div icon for the building showing a small badge of total floors
      const hasRestroom = csData.some((r) => r.楼宇 === b.楼宇)
      const floors = Number.isFinite(Number(b.总楼层数)) ? b.总楼层数 : "-"
      const iconHtml = `
        <div class="building-icon-label">
          <span class="building-name">${b.楼宇}</span>
          <span class="building-floors">(${floors}层)</span>
        </div>
      `
      const icon = L.divIcon({ className: "custom-building-icon", html: iconHtml, iconSize: [80, 24], iconAnchor: [40, 12] })
      const marker = L.marker([lat, lng], { icon })

      // tooltip shows building name, total floors and whether it has restroom
      const tooltipHtml = `
        <div style="text-align:center; min-width:120px">
          <strong>${b.楼宇}</strong><br/>
          楼层: ${floors}<br/>
          ${hasRestroom ? '<span style="color:#10b981">有卫生间</span>' : '<span style="color:#ef4444">无卫生间</span>'}
        </div>
      `
      marker.bindTooltip(tooltipHtml, { direction: "top", className: "building-tooltip" })
      marker.on("click", () => {
        try {
          // set current selection to this building and open floor selection modal
          currentSelection.building = b.楼宇
          // find campus owning this building
          for (const campus of buildingList) {
            if (campus.楼宇 && campus.楼宇.includes(b.楼宇)) {
              currentSelection.campus = campus.校区
              break
            }
          }
          syncComboBoxes()
          selectedBuildingForModal = b
          pendingMatchedRestroom = null
          matchPending = false
          // ensure modal prepared for this building
          showFloorSelectionModal(b)
        } catch (e) {
          console.warn(e)
        }
      })
      markersLayer.addLayer(marker)

      // draw scope circle with light opacity
      const radius = Number(b.半径) || 30
      const circle = L.circle([lat, lng], {
        radius: radius,
        color: "#0078d4",
        weight: 1,
        fillColor: "#0078d4",
        fillOpacity: 0.06,
      })
      markersLayer.addLayer(circle)
    } catch (e) {
      // ignore per-building errors
    }
  })
}

function updateUserMarker() {
  if (!map || !userLocation) return
  const lat = Number(userLocation.latitude)
  const lng = Number(userLocation.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return

  if (userMarker) {
    userMarker.setLatLng([lat, lng])
  } else {
    userMarker = L.circleMarker([lat, lng], {
      radius: 7,
      color: "#ff0000",
      weight: 2,
      fillColor: "#ff0000",
      fillOpacity: 1,
    }).addTo(map)
  }

  // center map on user once
  if (!userCentered) {
    map.setView([lat, lng], 18)
    userCentered = true
  }
}

function clearMapMarkers() {
  if (markersLayer) markersLayer.clearLayers()
}

// Update restroom display
function updateRestroomDisplay() {
  console.log("[Asul] Updating display for:", currentSelection)
  // Filter restrooms based on whichever selection fields are filled
  const filteredRestrooms = csData.filter((restroom) => {
    if (currentSelection.campus && restroom.校区 !== currentSelection.campus) return false
    if (currentSelection.building && restroom.楼宇 !== currentSelection.building) return false
    if (currentSelection.floor && restroom.楼层 !== currentSelection.floor) return false
    return true
  })

  // Consider selection complete only when campus, building and floor are all chosen
  const isSelectionComplete = !!currentSelection.campus && !!currentSelection.building && Number.isInteger(currentSelection.floor)

  if (isSelectionComplete) {
    // Only when user has fully specified campus/building/floor do we check for absence
    if (filteredRestrooms.length === 0) {
      noRestroomModal.classList.add("show")
      currentSelection.restroom = null
      clearDetailsCard()
    } else {
      // Select first restroom and show details
      currentSelection.restroom = filteredRestrooms[0]
      updateDetailsCard(filteredRestrooms[0])
    }
  } else {
    // Incomplete selection: do not show "no restroom" modal and do not auto-select
    if (noRestroomModal.classList.contains("show")) noRestroomModal.classList.remove("show")
    currentSelection.restroom = null
    clearDetailsCard()
  }

  // Render restrooms list according to current filters (may be broad when selection incomplete)
  renderRestroomsList()
  // Make sure combo boxes reflect any changes performed during update
  syncComboBoxes()
}

// Update details card
function updateDetailsCard(restroom) {
  // show campus · building · floor as a read-only line
  locationShort.textContent = `${restroom.校区 || '-'} · ${restroom.楼宇 || '-'} · ${restroom.楼层 || '-'}楼`
  restroomType.textContent = restroom.卫生间属性
  roomNumber.textContent = restroom.附近的房间号 || "无"
  locationDesc.textContent = restroom.具体位置描述 // Removed coordinate concatenation
  coordinates.textContent =
    restroom.经度 && restroom.纬度 ? `${restroom.纬度.toFixed(6)}, ${restroom.经度.toFixed(6)}` : "无"
  notes.textContent = restroom.备注 || "无"
}

// Clear details card
function clearDetailsCard() {
  locationShort.textContent = "-"
  restroomType.textContent = "请选择卫生间"
  roomNumber.textContent = "-"
  locationDesc.textContent = "-"
  coordinates.textContent = "-" // Clear coordinates field
  notes.textContent = "-"
}

// Render restrooms list
function renderRestroomsList() {
  restroomsList.innerHTML = ""
  // Show ALL restrooms (do not filter by the top selection)
  const all = csData.slice()

  // Update total count badge
  if (restroomsCount) restroomsCount.textContent = `${all.length}`

  all.forEach((restroom) => {
    // Skip if it's the currently selected restroom (we show it in the details card)
      const isCurrent =
        currentSelection.restroom &&
        restroom.校区 === currentSelection.restroom.校区 &&
        restroom.楼宇 === currentSelection.restroom.楼宇 &&
        restroom.楼层 === currentSelection.restroom.楼层 &&
        restroom.卫生间属性 === currentSelection.restroom.卫生间属性

      if (isCurrent) {
        // Mark the currently selected restroom in the list instead of skipping it
        // Additional logic to visually mark the restroom can be added here
      }

    const button = document.createElement("button")
    button.className = "restroom-btn fade-in"

    let distanceText = ""
      if (userLocation && Number.isFinite(restroom.经度) && Number.isFinite(restroom.纬度)) {
        const distance = calculateDistance(userLocation.latitude, userLocation.longitude, restroom.纬度, restroom.经度)
        const color = getDistanceColor(distance)
        distanceText = `<span class="restroom-distance" style="color: ${color}; font-weight: 600;">${Math.round(distance)}M</span>`
      }

    button.innerHTML = `
            <div class="restroom-info">
                <span class="restroom-tag">${restroom.校区}</span>
                <span class="restroom-tag">${restroom.楼宇}</span>
                <span class="restroom-tag">${restroom.楼层}楼</span>
                <span class="restroom-tag">${restroom.卫生间属性}</span>
            </div>
            ${distanceText}
        `

    button.addEventListener("click", () => {
      // If there are multiple restroom entries that share campus/building/floor, ask user to choose
      const matches = csData.filter((r) => r.校区 === restroom.校区 && r.楼宇 === restroom.楼宇 && r.楼层 === restroom.楼层)
      if (matches.length > 1) {
        // Populate choose modal
        if (chooseRestroomList) chooseRestroomList.innerHTML = ""
        matches.forEach((m) => {
          const b = document.createElement("button")
          b.className = "choose-btn"
          b.textContent = `${m.卫生间属性} ${m.附近的房间号 ? '· ' + m.附近的房间号 : ''}`
          b.addEventListener("click", () => {
            // select the chosen restroom and close modal
            selectRestroom(m)
            if (chooseRestroomModal) chooseRestroomModal.classList.remove("show")
            if (chooseRestroomList) chooseRestroomList.innerHTML = ""
          })
          if (chooseRestroomList) chooseRestroomList.appendChild(b)
        })
        if (chooseRestroomModal) chooseRestroomModal.classList.add("show")
      } else {
        // single match — just select
        selectRestroom(restroom)
      }
    })

    restroomsList.appendChild(button)
  })
}

// Select a restroom
function selectRestroom(restroom) {
  console.log("[Asul] Restroom selected:", restroom)

  // Update selection
  currentSelection.campus = restroom.校区
  currentSelection.building = restroom.楼宇
  currentSelection.floor = restroom.楼层
  currentSelection.restroom = restroom

  // Update dropdowns
  campusSelect.value = restroom.校区
  populateBuildingSelect(restroom.校区)
  buildingSelect.value = restroom.楼宇
  populateFloorSelect(restroom.楼宇)
  floorSelect.value = restroom.楼层

  // Ensure all combo boxes are synchronized to this selection
  syncComboBoxes()

  // Update display with animation
  updateDetailsCard(restroom)
  renderRestroomsList()

  // Scroll to top smoothly
  window.scrollTo({ top: 0, behavior: "smooth" })
}

function getDistanceColor(distance) {
  // Define distance thresholds (in meters)
  const nearThreshold = 50 // Green for distances <= 50m
  const farThreshold = 200 // Red for distances >= 200m

  if (distance <= nearThreshold) {
    // Green
    return "#10b981"
  } else if (distance >= farThreshold) {
    // Red
    return "#ef4444"
  } else {
    // Yellow gradient between near and far
    const ratio = (distance - nearThreshold) / (farThreshold - nearThreshold)
    // Interpolate from green (#10b981) to yellow (#eab308) to red (#ef4444)
    if (ratio < 0.5) {
      // Green to yellow
      const r = Math.round(16 + (234 - 16) * (ratio * 2))
      const g = Math.round(185 + (179 - 185) * (ratio * 2))
      const b = Math.round(129 + (8 - 129) * (ratio * 2))
      return `rgb(${r}, ${g}, ${b})`
    } else {
      // Yellow to red
      const r = Math.round(234 + (239 - 234) * ((ratio - 0.5) * 2))
      const g = Math.round(179 + (68 - 179) * ((ratio - 0.5) * 2))
      const b = Math.round(8 + (68 - 8) * ((ratio - 0.5) * 2))
      return `rgb(${r}, ${g}, ${b})`
    }
  }
}

// Start the app
init()
