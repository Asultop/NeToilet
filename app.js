// 数据存储
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
let pendingNearestRestroom = null // 在进入楼宇时用于记住最近的卫生间
// 地图相关
let map = null
let markersLayer = null
let userMarker = null
let userCentered = false // 是否已将地图初次居中到用户位置
let selectedBuildingForModal = null
let pendingMatchedRestroom = null
let matchPending = false
// 地图管理数据结构
let buildingCircles = new Map() // 楼宇名称 -> Leaflet 圆圈对象
let buildingCenters = new Map() // 楼宇名称 -> {lat,lng,radius}
let watchId = null
let buildingInside = new Map() // 楼宇名称 -> boolean （用户是否在楼宇内）
let lastHighlightedBuilding = null
let buildingEnterTimers = new Map() // 楼宇名称 -> { timeoutId, intervalId }（进入检测的防抖/倒计时）
let watchStartedOnce = false
let isMockingLocation = false
// 上一次用户位置（用于计算移动方向）
let prevUserLocation = null
// 是否允许自动跟随（保持 false，自动跟随功能已移除，改为手动“定位到我”控件）
let autoFollowEnabled = false
// 在模态打开时，缓存最后一次位置更新，模态关闭后一次性应用
let pendingLocationUpdate = null
let pendingLocationProcessing = false
let locationResumeTimer = null
// Modal 变化观察者（用于在模态关闭时触发挂起位置的应用）
let modalObserver = null
// Timer used when waiting for an initial locating result (show failure after timeout)
let locationTimeoutTimer = null

// 用于缓存并重用“所有卫生间”列表的按钮，避免在每次位置刷新时重建 DOM 导致闪烁
const restroomButtonCache = new Map()

// 地图控件引用（右上 Fluent 控件）
let recenterControlButton = null

// DOM 元素引用
const campusSelect = document.getElementById("campusSelect")
const buildingSelect = document.getElementById("buildingSelect")
const floorSelect = document.getElementById("floorSelect")
const restroomType = document.getElementById("restroomType")
const locationShort = document.getElementById("locationShort")
const roomNumber = document.getElementById("roomNumber")
const locationDesc = document.getElementById("locationDesc")
const coordinates = document.getElementById("coordinates") // 坐标显示元素
const notes = document.getElementById("notes")
const restroomsList = document.getElementById("restroomsList")
const restroomsCount = document.getElementById("restroomsCount")
const detailsCard = document.getElementById("detailsCard")
const chooseRestroomModal = document.getElementById("chooseRestroomModal")
const chooseRestroomList = document.getElementById("chooseRestroomList")
const cancelChooseRestroom = document.getElementById("cancelChooseRestroom")
const locationModal = document.getElementById("locationModal")
const enterBuildingModal = document.getElementById("enterBuildingModal")
const enterBuildingTitle = document.getElementById("enterBuildingTitle")
const enterBuildingBody = document.getElementById("enterBuildingBody")
const enterBuildingMatches = document.getElementById("enterBuildingMatches")
const enterBuildingGo = document.getElementById("enterBuildingGo")
const enterBuildingCancel = document.getElementById("enterBuildingCancel")
const enterConfirmToast = document.getElementById("enterConfirmToast")
const enterConfirmProgressCircle = document.getElementById("enterConfirmProgressCircle")
const enterConfirmBuildingLabel = document.getElementById("enterConfirmBuilding")
const enterConfirmSeconds = document.getElementById("enterConfirmSeconds")
const directionShort = document.getElementById("directionShort")
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
  // Initialize theme first so map markers/circles use correct theme colors
  initializeTheme()
  // Initialize map and add building markers (use linkerData)
  initMap()
  addBuildingMarkersToMap()
  setupEventListeners()
  requestLocationPermission()
  // Start observing modals so we can apply pending location updates when modals close
  try { setupModalObserver() } catch (e) { /* ignore */ }
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
  // re-style building circles to match theme
  try {
    const isDark = document.body.classList.contains('dark-theme')
    const strokeColor = isDark ? '#60cdff' : '#0078d4'
    buildingCircles.forEach((c) => {
      if (c && c.setStyle) c.setStyle({ color: strokeColor, fillColor: strokeColor })
    })
    if (map) setTimeout(() => map.invalidateSize(), 120)
  } catch (e) {}
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

// Return true when a blocking modal (any modal except the location permission/locating modal)
// is currently open. We exclude the `locationModal` so the locating flow still works.
function isModalOpenBlocking() {
  const modals = document.querySelectorAll('.modal.show')
  for (const m of modals) {
    if (!m) continue
    if (m.id === 'locationModal') continue
    return true
  }
  return false
}

// Apply any pending (cached) location update that was deferred while modal(s) were open
function applyPendingLocation() {
  if (!pendingLocationUpdate) return
  try {
    userLocation = pendingLocationUpdate
    pendingLocationUpdate = null
    updateDebugInfo()
    updateUserMarker()
    checkBuildingProximityDebounced()
    findNearestRestroom()
  } catch (e) {
    console.warn('[Asul] applyPendingLocation failed', e)
  }
}

// Observe modal class changes and when no blocking modal remains, apply pending location
function setupModalObserver() {
  if (modalObserver) return
  try {
    const observer = new MutationObserver(() => {
      if (!isModalOpenBlocking() && pendingLocationUpdate) applyPendingLocation()
    })
    document.querySelectorAll('.modal').forEach((m) => {
      observer.observe(m, { attributes: true, attributeFilter: ['class'] })
    })
    modalObserver = observer
  } catch (e) {
    console.warn('[Asul] setupModalObserver failed', e)
  }
}

// Create and show a simple modal telling the user locating failed with Retry/Cancel
function showLocationFailedModal() {
  try {
    // If modal already exists, just ensure it's visible
    let m = document.getElementById('locationFailedModal')
    if (!m) {
      m = document.createElement('div')
      m.className = 'modal'
      m.id = 'locationFailedModal'
      m.innerHTML = `
        <div class="modal-content">
          <h3>定位失败</h3>
          <p>无法获取位置信息。请检查设备定位设置或网络！</p>
          <div class="modal-buttons">
            <button class="btn-primary" id="retryLocateBtn">重试</button>
            <button class="btn-secondary" id="cancelLocateBtn">取消</button>
          </div>
        </div>
      `
      document.body.appendChild(m)
      // attach handlers
      const retry = document.getElementById('retryLocateBtn')
      const cancel = document.getElementById('cancelLocateBtn')
      if (retry) retry.addEventListener('click', () => {
        try { m.classList.remove('show') } catch (e) {}
        try { m.remove() } catch (e) {}
        // retry: start locating flow again
        startLocating()
      })
      if (cancel) cancel.addEventListener('click', () => {
        try { if (locationTimeoutTimer) { clearTimeout(locationTimeoutTimer); locationTimeoutTimer = null } } catch (e) {}
        try { m.classList.remove('show') } catch (e) {}
        try { m.remove() } catch (e) {}
        // close the locating modal if shown and fallback to manual selection
        try { if (locationModal && locationModal.classList) locationModal.classList.remove('show') } catch (e) {}
        try { manualSelection(); updateRestroomDisplay() } catch (e) {}
      })
    }
    // show it
    setTimeout(() => { try { m.classList.add('show') } catch (e) {} }, 5)
  } catch (e) {
    console.warn('[Asul] showLocationFailedModal failed', e)
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

    // Normalize cs coordinates: if values appear swapped (纬度 outside [-90,90]), swap 经度/纬度
    csData.forEach((r) => {
      if (r && Number.isFinite(r.纬度) && Number.isFinite(r.经度)) {
        // if 纬度 is implausible (> 90 or < -90) but 经度 is plausible (>90), swap
        if (r.纬度 > 90 || r.纬度 < -90) {
          const tmp = r.纬度
          r.纬度 = r.经度
          r.经度 = tmp
        }
      }
    })
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

  // modal floor select (manual) -> render suggestions table when a floor is picked
  manualFloorSelect.addEventListener("change", (e) => {
    const val = Number.parseInt(e.target.value)
    if (Number.isFinite(val)) {
      renderFloorSuggestions(currentSelection.building, val)
    } else {
      // render all restrooms for current building (show full list) when no specific floor selected
      if (currentSelection.building) {
        renderFloorSuggestions(currentSelection.building, null)
      } else {
        // clear suggestions container if present
        const c = document.getElementById('floorSuggestionsContainer')
        if (c) c.innerHTML = ''
      }
    }
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

// Render a floor-suggestion table inside the floor modal.
// Shows rows grouped by floor relative to selectedFloor: order 0, -1, -2, ... , +1, +2, ...
function renderFloorSuggestions(buildingName, selectedFloor) {
  try {
    const containerId = 'floorSuggestionsContainer'
    let container = document.getElementById(containerId)
    const fm = document.getElementById('floorMatchResult')
    if (!container) {
      // create a container under fm (or inside modal content)
      container = document.createElement('div')
      container.id = containerId
      container.style.marginTop = '12px'
      container.style.display = 'block'
      if (fm && fm.parentNode) fm.parentNode.insertBefore(container, fm.nextSibling)
    }
    // clear
    container.innerHTML = ''

    if (!buildingName) return

    const buildingData = linkerData.find((b) => b.楼宇 === buildingName)
    const maxFloors = buildingData && Number.isFinite(Number(buildingData.总楼层数)) ? Number(buildingData.总楼层数) : 50

    // gather restrooms grouped by floor
    const restroomsInBuilding = csData.filter((r) => r.楼宇 === buildingName)
    if (restroomsInBuilding.length === 0) {
      container.textContent = '该楼宇暂无已记录的卫生间'
      return
    }

    // determine unique floors that have restrooms
    const floorsSet = new Set(restroomsInBuilding.map((r) => Number(r.楼层)).filter((n) => Number.isFinite(n)))
    const floors = Array.from(floorsSet).sort((a, b) => a - b)

    // helper to build label
    const floorLabel = (diff) => {
      if (diff === 0) return '当前层'
      if (diff > 0) return `上${diff}层`
      return `下${Math.abs(diff)}层`
    }

    // create table/list container
    const table = document.createElement('div')
    table.className = 'floor-suggestions'

    // We'll render each restroom as a row with floor, relative label and details
  // Determine a reference floor (selectedFloor > currentSelection.floor > pendingNearestRestroom.floor)
  let cur = null
  if (Number.isFinite(Number(selectedFloor))) cur = Number(selectedFloor)
  else if (Number.isFinite(Number(currentSelection.floor))) cur = Number(currentSelection.floor)
  else if (pendingNearestRestroom && Number.isFinite(Number(pendingNearestRestroom.楼层))) cur = Number(pendingNearestRestroom.楼层)
    const items = []

    restroomsInBuilding.forEach((m) => {
      const floorNum = Number(m.楼层)
      if (!Number.isFinite(floorNum)) return
      const diff = cur !== null ? floorNum - cur : null
      const absDiff = diff !== null ? Math.abs(diff) : Number.POSITIVE_INFINITY
      let category = null
      if (diff !== null) {
        if (absDiff <= 1) category = 'green'
        else if (absDiff === 2) category = 'yellow'
        else category = 'red'
      }

      // compute distance if possible
      let dist = Number.POSITIVE_INFINITY
      if (userLocation && Number.isFinite(m.经度) && Number.isFinite(m.纬度)) {
        try { dist = calculateDistance(userLocation.latitude, userLocation.longitude, m.纬度, m.经度) } catch (e) { dist = Number.POSITIVE_INFINITY }
      }

      items.push({ meta: m, floor: floorNum, diff, absDiff, category, dist })
    })

    // sort items by category priority then absDiff then distance
    const priority = { green: 0, yellow: 1, red: 2 }
    items.sort((a, b) => {
      // if both have no category (no baseline), sort by floor asc then distance
      if (a.category === null && b.category === null) {
        if (a.floor !== b.floor) return a.floor - b.floor
        return (a.dist || Number.POSITIVE_INFINITY) - (b.dist || Number.POSITIVE_INFINITY)
      }
      // if one has category and other does not, place the one with category first
      if (a.category === null && b.category !== null) return 1
      if (a.category !== null && b.category === null) return -1
      // both have categories: use defined priority
      if (priority[a.category] !== priority[b.category]) return priority[a.category] - priority[b.category]
      if (a.absDiff !== b.absDiff) return a.absDiff - b.absDiff
      return (a.dist || Number.POSITIVE_INFINITY) - (b.dist || Number.POSITIVE_INFINITY)
    })

    items.forEach((it) => {
      const m = it.meta
  const row = document.createElement('div')
  const cls = 'floor-row floor-item' + (it.category ? ` floor-priority-${it.category}` : '')
  row.className = cls
      row.style.display = 'flex'
      row.style.justifyContent = 'space-between'
      row.style.alignItems = 'center'
      row.style.padding = '8px 10px'

      const left = document.createElement('div')
      if (it.diff === null) {
        left.innerHTML = `${it.floor}楼`
      } else {
        left.innerHTML = `<strong>${floorLabel(it.diff)}</strong> · ${it.floor}楼`
      }

      const right = document.createElement('div')
      right.style.display = 'flex'
      right.style.gap = '12px'
      right.style.alignItems = 'center'

      const info = document.createElement('div')
      info.textContent = `${m.卫生间属性}${m.附近的房间号 ? ' · ' + m.附近的房间号 : ''}`

      const distEl = document.createElement('div')
      distEl.className = 'restroom-distance'
      if (isFinite(it.dist)) {
        distEl.textContent = `${Math.round(it.dist)}M`
        distEl.style.color = getDistanceColor(it.dist)
        distEl.style.fontWeight = '600'
      } else {
        distEl.textContent = '-' 
      }

      right.appendChild(info)
      right.appendChild(distEl)

      row.appendChild(left)
      row.appendChild(right)

      // clicking a row selects the restroom and closes modal
      row.addEventListener('click', () => {
        selectRestroom(m)
        try { if (floorModal) floorModal.classList.remove('show') } catch (e) {}
      })

      table.appendChild(row)
    })

    container.appendChild(table)
  } catch (e) {
    console.warn('[Asul] renderFloorSuggestions failed', e)
  }
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
    currentSelection.campus = val || ""
    if (!val) {
      currentSelection.building = ""
      currentSelection.floor = null
      buildingSelect.innerHTML = '<option value="">选择楼宇</option>'
      floorSelect.innerHTML = '<option value="">选择楼层</option>'
      syncComboBoxes()
      updateRestroomDisplay()
      return
    }
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
      currentSelection.floor = null
      floorSelect.innerHTML = '<option value="">选择楼层</option>'
      syncComboBoxes()
      updateRestroomDisplay()
      return
    }
    populateFloorSelect(val)
    currentSelection.floor = null
    floorSelect.value = ""
    syncComboBoxes()
    updateRestroomDisplay()
  })

  // floorSelect (page-level) changes
  floorSelect.addEventListener("change", (e) => {
    const val = Number.parseInt(e.target.value)
    currentSelection.floor = Number.isNaN(val) ? null : val
    updateRestroomDisplay()
    if (currentSelection.campus && currentSelection.building && currentSelection.floor) {
      const matches = csData.filter((r) => r.校区 === currentSelection.campus && r.楼宇 === currentSelection.building && r.楼层 === currentSelection.floor)
      if (matches.length > 1) {
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
        selectRestroom(matches[0])
      }
    }
  })



  document.getElementById("allowLocation").addEventListener("click", () => {
    startLocating()
    // Also request a one-time current position and center the map immediately when available
    try {
      if (navigator.geolocation && navigator.geolocation.getCurrentPosition) {
        navigator.geolocation.getCurrentPosition((position) => {
          try {
            const lat = Number(position.coords.latitude)
            const lng = Number(position.coords.longitude)
            if (Number.isFinite(lat) && Number.isFinite(lng) && map) {
              try { map.setView([lat, lng], Math.max(map.getZoom(), 18)) } catch (e) {}
            }
          } catch (e) { /* ignore */ }
        }, (err) => { /* ignore one-shot error, watchPosition will handle updates */ }, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 })
      }
    } catch (e) {}
  })

  document.getElementById("denyLocation").addEventListener("click", () => {
    // clear any pending location timeout
    try { if (locationTimeoutTimer) { clearTimeout(locationTimeoutTimer); locationTimeoutTimer = null } } catch (e) {}
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

  // copy-coordinates control removed per UX decision

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
  // Start continuous location watch so we can trigger enter events with debounce
  startWatchingLocation()
  // Start a one-time timeout: if no location fix within 10s, show failure modal
  try {
    if (locationTimeoutTimer) { clearTimeout(locationTimeoutTimer); locationTimeoutTimer = null }
    locationTimeoutTimer = setTimeout(() => {
      locationTimeoutTimer = null
      // If still no fix and the locating modal is visible, show failure UI
      if (!watchStartedOnce && locationModal && locationModal.classList && locationModal.classList.contains('show')) {
        showLocationFailedModal()
      }
    }, 10000)
  } catch (e) {}
}

// Start continuous watch of user position with watchPosition
function startWatchingLocation() {
  if (!("geolocation" in navigator)) return
  if (watchId !== null) return
  watchId = navigator.geolocation.watchPosition(
    (position) => {
      // If developer mocking is active, ignore real geolocation updates so mock location remains
      if (isMockingLocation) return
      // preserve previous location for bearing computation
      if (userLocation) prevUserLocation = { ...userLocation }
      userLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        altitude: position.coords.altitude,
        heading: (typeof position.coords.heading === 'number' && !Number.isNaN(position.coords.heading)) ? position.coords.heading : null,
        speed: (typeof position.coords.speed === 'number' && !Number.isNaN(position.coords.speed)) ? position.coords.speed : null,
      }
      updateDebugInfo()
      // If a blocking modal is open (any modal except the location/locating modal),
      // defer processing of this location update to avoid interrupting the user's selection.
      if (isModalOpenBlocking()) {
        pendingLocationUpdate = { ...userLocation }
        return
      }
      updateUserMarker()
      // On first successful fix, close locating modal similar to one-shot flow
      if (!watchStartedOnce) {
        // clear locating timeout if any
        try { if (locationTimeoutTimer) { clearTimeout(locationTimeoutTimer); locationTimeoutTimer = null } } catch (e) {}
        const perm = document.getElementById("permissionState")
        const locating = document.getElementById("locatingState")
        setTimeout(() => {
          if (locating) locating.style.display = "none"
          if (perm) perm.style.display = "block"
          if (locationModal && locationModal.classList) locationModal.classList.remove("show")
          // if a locate-failed modal exists, remove it
          try { const fm = document.getElementById('locationFailedModal'); if (fm) { fm.classList.remove('show'); fm.remove() } } catch (e) {}
        }, 600)
        watchStartedOnce = true
      }
      // proximity check with debounce
      checkBuildingProximityDebounced()
      // update nearest suggestion
      findNearestRestroom()
    },
    (err) => {
      console.warn('[Asul] watchPosition error', err)
    },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 },
  )
}

// DevTools helper: set a mock location from console and suspend real geolocation updates
window.__mockLocation = function (lat, lng) {
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    console.error('[Asul] __mockLocation expects numeric lat,lng')
    return
  }
  isMockingLocation = true
  userLocation = { latitude: lat, longitude: lng, altitude: null }
  console.log(`[Asul] Mocking location set to ${lat}, ${lng}`)
  try {
    if (typeof updateDebugInfo === 'function') updateDebugInfo()
    if (typeof updateUserMarker === 'function') updateUserMarker()
    if (typeof checkBuildingProximityDebounced === 'function') checkBuildingProximityDebounced()
    if (typeof findNearestRestroom === 'function') findNearestRestroom()
  } catch (e) {
    console.warn('[Asul] Error while applying mock location updates', e)
  }
}

// Stop mocking and allow real geolocation to resume
window.__stopMockLocation = function () {
  isMockingLocation = false
  console.log('[Asul] Mocking disabled; real geolocation will resume')
}

function stopWatchingLocation() {
  if (watchId !== null && navigator.geolocation && navigator.geolocation.clearWatch) {
    navigator.geolocation.clearWatch(watchId)
    watchId = null
  }
}

// 5s debounce enter detection: require user to remain inside circle for 5s
function checkBuildingProximityDebounced() {
  if (!userLocation) return
  const now = Date.now()
  // iterate centers
  buildingCenters.forEach((center, building) => {
    const d = calculateDistance(userLocation.latitude, userLocation.longitude, center.lat, center.lng)
    const inside = d <= (Number(center.radius) || 30)
    const confirmedInside = !!buildingInside.get(building)
    const pendingTimer = buildingEnterTimers.get(building)

    if (inside && !confirmedInside && !pendingTimer) {
      // start 3s timer to confirm, and show circular progress toast
      const duration = 3000
      const startTime = Date.now()
      // show toast
      if (enterConfirmToast) {
        if (enterConfirmBuildingLabel) enterConfirmBuildingLabel.textContent = building
        if (enterConfirmSeconds) enterConfirmSeconds.textContent = Math.ceil(duration / 1000)
        enterConfirmToast.style.display = 'block'
        enterConfirmToast.setAttribute('aria-hidden', 'false')
      }

      // if SVG circle exists, animate stroke-dashoffset; otherwise fallback to text countdown
      if (enterConfirmProgressCircle && typeof enterConfirmProgressCircle.getTotalLength === 'function') {
        const total = enterConfirmProgressCircle.getTotalLength()
        // ensure proper attributes
        enterConfirmProgressCircle.style.strokeDasharray = total
        enterConfirmProgressCircle.style.strokeDashoffset = total

        const intervalId = setInterval(() => {
          const elapsed = Date.now() - startTime
          const frac = Math.min(1, elapsed / duration)
          const offset = total * (1 - frac)
          enterConfirmProgressCircle.style.strokeDashoffset = offset
          if (enterConfirmSeconds) enterConfirmSeconds.textContent = Math.max(0, Math.ceil((duration - elapsed) / 1000))
        }, 50)

        const tid = setTimeout(() => {
          // if still inside, mark confirmed and fire enter
          const dd = calculateDistance(userLocation.latitude, userLocation.longitude, center.lat, center.lng)
          if (dd <= (Number(center.radius) || 30)) {
            buildingInside.set(building, true)
            const linkerObj = linkerData.find((b) => b.楼宇 === building)
            if (linkerObj) handleEnterBuilding(linkerObj)
          }
          // clear UI and timers
          if (enterConfirmToast) {
            enterConfirmToast.style.display = 'none'
            enterConfirmToast.setAttribute('aria-hidden', 'true')
          }
          clearInterval(intervalId)
          // reset dashoffset for next time
          try { enterConfirmProgressCircle.style.strokeDashoffset = total } catch (e) {}
          buildingEnterTimers.delete(building)
        }, duration)

        buildingEnterTimers.set(building, { timeoutId: tid, intervalId: intervalId })
      } else {
        // fallback: textual countdown every second
        let seconds = 3
        if (enterConfirmToast) {
          enterConfirmToast.textContent = `即将确认进入 ${building} （${seconds}s）`
          enterConfirmToast.style.display = 'block'
          enterConfirmToast.setAttribute('aria-hidden', 'false')
        }
        const intervalId = setInterval(() => {
          seconds -= 1
          if (enterConfirmToast) enterConfirmToast.textContent = `即将确认进入 ${building} （${seconds}s）`
        }, 1000)
        const tid = setTimeout(() => {
          const dd = calculateDistance(userLocation.latitude, userLocation.longitude, center.lat, center.lng)
          if (dd <= (Number(center.radius) || 30)) {
            buildingInside.set(building, true)
            const linkerObj = linkerData.find((b) => b.楼宇 === building)
            if (linkerObj) handleEnterBuilding(linkerObj)
          }
          if (enterConfirmToast) { enterConfirmToast.style.display = 'none'; enterConfirmToast.setAttribute('aria-hidden', 'true') }
          clearInterval(intervalId)
          buildingEnterTimers.delete(building)
        }, duration)
        buildingEnterTimers.set(building, { timeoutId: tid, intervalId: intervalId })
      }
    } else if (!inside && pendingTimer) {
      // left before 3s: cancel timer and hide toast
      if (pendingTimer.timeoutId) clearTimeout(pendingTimer.timeoutId)
      if (pendingTimer.intervalId) clearInterval(pendingTimer.intervalId)
      // hide and reset progress UI
      if (enterConfirmToast) {
        enterConfirmToast.style.display = 'none'
        enterConfirmToast.setAttribute('aria-hidden', 'true')
      }
      if (enterConfirmProgressCircle) {
        try { const total = enterConfirmProgressCircle.getTotalLength(); enterConfirmProgressCircle.style.strokeDashoffset = total } catch (e) {}
      }
      buildingEnterTimers.delete(building)
    } else if (!inside && confirmedInside) {
      // user has left after being inside - update state silently
      buildingInside.set(building, false)
      // ensure any pending timer cleared
      if (pendingTimer) { if (pendingTimer.timeoutId) clearTimeout(pendingTimer.timeoutId); if (pendingTimer.intervalId) clearInterval(pendingTimer.intervalId); buildingEnterTimers.delete(building) }
    }
    // if inside and already confirmedInside -> nothing (we don't re-trigger)
  })
}

// Handle when user is confirmed to have entered a building (after debounce)
let pendingEnterRestroom = null
function handleEnterBuilding(buildingObj) {
  if (!enterBuildingModal) return
  enterBuildingTitle.textContent = `进入楼宇：${buildingObj.楼宇}`
  enterBuildingBody.textContent = `检测到您进入 ${buildingObj.楼宇}，正在从一楼到 ${buildingObj.总楼层数} 楼查找是否存在卫生间...`
  enterBuildingMatches.innerHTML = ''

  const restroomsInBuilding = csData.filter((r) => r.楼宇 === buildingObj.楼宇)
  if (restroomsInBuilding.length === 0) {
    const p = document.createElement('div')
    p.textContent = '未找到已记录的卫生间。'
    enterBuildingMatches.appendChild(p)
    pendingEnterRestroom = null
  } else {
    // choose nearest by distance to user if possible
    let nearest = restroomsInBuilding[0]
    if (userLocation && restroomsInBuilding.some((r) => Number.isFinite(r.经度) && Number.isFinite(r.纬度))) {
      let minDist = Number.POSITIVE_INFINITY
      restroomsInBuilding.forEach((r) => {
        if (Number.isFinite(r.经度) && Number.isFinite(r.纬度)) {
          const d = calculateDistance(userLocation.latitude, userLocation.longitude, r.纬度, r.经度)
          if (d < minDist) { minDist = d; nearest = r }
        }
      })
    }
    // show a short summary and store pending
    const info = document.createElement('div')
    info.innerHTML = `${nearest.校区 || '-'} · ${nearest.楼宇 || '-'} · ${nearest.楼层 || '-'}楼 · ${nearest.卫生间属性 || '-'} · ${nearest.附近的房间号 || ''}`
    enterBuildingMatches.appendChild(info)
    pendingEnterRestroom = nearest
  }

  // show modal
  enterBuildingModal.classList.add('show')

  // wire buttons
  if (enterBuildingGo) {
    enterBuildingGo.onclick = () => {
      if (pendingEnterRestroom) selectRestroom(pendingEnterRestroom)
      const c = buildingCircles.get(buildingObj.楼宇)
      if (c) c.setStyle({ color: '#10b981', fillColor: '#10b981' })
      enterBuildingModal.classList.remove('show')
    }
  }
  if (enterBuildingCancel) {
    enterBuildingCancel.onclick = () => {
      const c = buildingCircles.get(buildingObj.楼宇)
      if (c) c.setStyle({ color: '#10b981', fillColor: '#10b981' })
      enterBuildingModal.classList.remove('show')
    }
  }
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
    // Instead of only showing the nearest restroom, render all restrooms for this building
    currentSelection.restroom = null
    renderBuildingDetails(buildingObj.楼宇)
  } else {
    currentSelection.restroom = null
    clearDetailsCard()
  }

  // Render the list filtered by currentSelection (which now has building but no floor)
  renderRestroomsList()
  // ensure all combo boxes reflect selection
  syncComboBoxes()
}

// Render all restrooms for a given building into the details card area
function renderBuildingDetails(buildingName) {
  try {
    if (!buildingName) return
    const restroomsInBuilding = csData.filter((r) => r.楼宇 === buildingName)
    // Clear simple details fields first
    locationShort.textContent = `${currentSelection.campus || '-'} · ${buildingName}`
    restroomType.textContent = `${restroomsInBuilding.length} 个卫生间` 
    roomNumber.textContent = '-'
    locationDesc.textContent = '-'
    coordinates.textContent = '-' 
    notes.textContent = '-' 

    // remove existing list if any
    const existing = document.getElementById('detailsRestroomList')
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing)

    const container = document.createElement('div')
    container.id = 'detailsRestroomList'
    container.style.marginTop = '10px'
    container.style.display = 'flex'
    container.style.flexDirection = 'column'
    container.style.gap = '8px'

    if (restroomsInBuilding.length === 0) {
      const p = document.createElement('div')
      p.textContent = '该楼宇暂无已记录的卫生间'
      container.appendChild(p)
    } else {
      // sort by floor then by distance if available
      restroomsInBuilding.forEach((r) => {
        r._sortFloor = Number.isFinite(Number(r.楼层)) ? Number(r.楼层) : 9999
        if (userLocation && Number.isFinite(r.经度) && Number.isFinite(r.纬度)) {
          r._distForDetails = calculateDistance(userLocation.latitude, userLocation.longitude, r.纬度, r.经度)
        } else {
          r._distForDetails = Number.POSITIVE_INFINITY
        }
      })
      restroomsInBuilding.sort((a, b) => {
        if (a._sortFloor !== b._sortFloor) return a._sortFloor - b._sortFloor
        return (a._distForDetails || Number.POSITIVE_INFINITY) - (b._distForDetails || Number.POSITIVE_INFINITY)
      })

      restroomsInBuilding.forEach((r) => {
        const row = document.createElement('div')
        row.className = 'detail-restroom-row'
        row.style.display = 'flex'
        row.style.justifyContent = 'space-between'
        row.style.alignItems = 'center'
        row.style.padding = '6px 8px'
        row.style.borderBottom = '1px solid rgba(0,0,0,0.04)'

        const left = document.createElement('div')
        left.innerHTML = `<strong>${r.楼层}楼</strong> · ${r.卫生间属性}${r.附近的房间号 ? ' · ' + r.附近的房间号 : ''}`
        const right = document.createElement('div')
        right.style.textAlign = 'right'
        if (Number.isFinite(r._distForDetails) && isFinite(r._distForDetails) && r._distForDetails !== Number.POSITIVE_INFINITY) {
          right.textContent = `${Math.round(r._distForDetails)}M`
          right.style.color = getDistanceColor(r._distForDetails)
        } else {
          right.textContent = '-'
        }

        row.appendChild(left)
        row.appendChild(right)

        row.addEventListener('click', () => {
          selectRestroom(r)
          // remove this list after selection
          try { const ex = document.getElementById('detailsRestroomList'); if (ex) ex.remove() } catch (e) {}
        })

        container.appendChild(row)
        // cleanup temp props
        try { delete r._sortFloor; delete r._distForDetails } catch (e) {}
      })
    }

    // append container to detailsCard
    if (detailsCard) detailsCard.appendChild(container)
  } catch (e) {
    console.warn('[Asul] renderBuildingDetails failed', e)
  }
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
  // Do NOT auto-preselect pendingNearestRestroom: always start in empty (选择楼层) state
  manualFloorSelect.value = ""
  // reset match UI
  const fm = document.getElementById("floorMatchResult")
  const fmMsg = document.getElementById("floorMatchMessage")
  const fmDetails = document.getElementById("floorMatchDetails")
  if (fm) fm.style.display = "none"
  if (fmMsg) fmMsg.textContent = ""
  if (fmDetails) fmDetails.textContent = ""
  // reset confirm button
  const confirmBtn = document.getElementById("confirmFloor")
  if (confirmBtn) {
    confirmBtn.textContent = "厕所信息"
    confirmBtn.classList.add('big-toilet-btn')
  }
  matchPending = false

  // Prepare initial building summary so the modal's lower result area shows association immediately
  const restroomsInBuilding = csData.filter((r) => r.楼宇 === building.楼宇)
  // We will not show the old intermediate match/info panel; instead render the full restroom list below the selector
  try {
    if (fm) fm.style.display = 'none'
  } catch (e) {}

  // hide the old confirm button (we list items directly and clicking an item selects it)
  try {
    if (confirmBtn) confirmBtn.style.display = 'none'
  } catch (e) {}

  // render suggestions/list for this building immediately in no-baseline mode
  renderFloorSuggestions(building.楼宇, null)

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
      // Use Esri World Imagery (satellite) tiles by default for better satellite view
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics',
        maxZoom: 19,
      }).addTo(map)
      map.setView(center, 16)

      markersLayer = L.layerGroup().addTo(map)
      // 简化用户交互：我们移除自动“恢复自动跟随”的倒计时与自动 pan 行为。
      // 交互处理只记录是否处于交互状态，自动跟随保持关闭，由用户手动触发“定位到我”按钮。
      let isUserInteracting = false
      const onInteractionStart = () => { try { isUserInteracting = true; autoFollowEnabled = false } catch (e) {} }
      const onInteractionEnd = () => { try { isUserInteracting = false } catch (e) {} }
      map.on('movestart', onInteractionStart)
      map.on('moveend', onInteractionEnd)
      map.on('dragstart', onInteractionStart)
      map.on('dragend', onInteractionEnd)
      map.on('zoomstart', onInteractionStart)
      map.on('zoomend', onInteractionEnd)
      map.on('mousedown', onInteractionStart)
      map.on('mouseup', onInteractionEnd)
      map.on('touchstart', onInteractionStart)
      map.on('touchend', onInteractionEnd)

      // Add a Fluent-style manual recenter control at top-right
      try {
        const RecenterControl = L.Control.extend({
          onAdd: function (map) {
            const container = L.DomUtil.create('div', 'map-control-card leaflet-bar')
            const btn = L.DomUtil.create('button', 'map-control-btn', container)
            btn.type = 'button'
            btn.title = '定位到我'
            btn.setAttribute('aria-label', '定位到我')
            btn.innerHTML = '<span class="map-control-label">恢复视图</span>'
            L.DomEvent.disableClickPropagation(container)
            L.DomEvent.on(btn, 'click', (e) => {
              L.DomEvent.stopPropagation(e)
              if (userLocation && map) {
                try { map.setView([Number(userLocation.latitude), Number(userLocation.longitude)], map.getZoom()) } catch (e) {}
              } else {
                try { requestLocationPermission() } catch (e) {}
              }
            })
            recenterControlButton = btn
            return container
          },
        })
        map.addControl(new RecenterControl({ position: 'topright' }))
      } catch (e) { console.warn('[Asul] failed to add recenter control', e) }
      // Ensure map resizes correctly when container or window size changes
      window.addEventListener('resize', () => {
        try { if (map) setTimeout(() => map.invalidateSize(), 120) } catch (e) {}
      })
    }
  } catch (e) {
    console.warn("[Asul] initMap failed:", e)
  }
}

// Smooth pan helper that shows a small progress indicator
function safePanTo(lat, lng, durationSec = 0.45, showProgress = false) {
  if (!map) return
  try {
    map.panTo([lat, lng], { animate: true, duration: durationSec })
  } catch (e) { console.warn('[Asul] safePanTo failed', e) }
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
  // record building center for proximity checks
  buildingCenters.set(b.楼宇, { lat, lng, radius: Number(b.半径) || 30 })

      // draw scope circle with light opacity; choose colors to suit current theme
      const radius = Number(b.半径) || 30
      const isDark = document.body.classList.contains('dark-theme')
      const strokeColor = isDark ? '#60cdff' : '#0078d4'
      const fillColor = strokeColor
      const fillOpacity = isDark ? 0.08 : 0.06
      const circle = L.circle([lat, lng], {
        radius: radius,
        color: strokeColor,
        weight: 1,
        fillColor: fillColor,
        fillOpacity: fillOpacity,
        className: 'building-circle',
      })
      markersLayer.addLayer(circle)
      // keep reference for later color updates / detection
      buildingCircles.set(b.楼宇, circle)
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
  // compute bearing: prefer device heading, fallback to movement bearing
  let bearing = null
  if (userLocation.heading !== null && Number.isFinite(userLocation.heading)) {
    bearing = userLocation.heading
  } else if (prevUserLocation && Number.isFinite(prevUserLocation.latitude) && Number.isFinite(prevUserLocation.longitude)) {
    bearing = calculateBearing(prevUserLocation.latitude, prevUserLocation.longitude, lat, lng)
  }

  const isDark = document.body.classList.contains('dark-theme')

  // create or update a modern divIcon marker showing direction
  const markerHtml = `<div class="user-marker-outer"><div class="user-marker-arrow" style="transform: rotate(${bearing || 0}deg)"></div></div>`
  if (userMarker) {
    if (userMarker.setLatLng) userMarker.setLatLng([lat, lng])
    if (userMarker.getElement) {
      const el = userMarker.getElement()
      if (el) {
        const arrow = el.querySelector('.user-marker-arrow')
        if (arrow) arrow.style.transform = `rotate(${bearing || 0}deg)`
      }
    }
  } else {
    const icon = L.divIcon({ className: 'user-marker', html: markerHtml, iconSize: [36, 36], iconAnchor: [18, 18] })
    userMarker = L.marker([lat, lng], { icon }).addTo(map)
  }

  // 自动跟随行为已移除；地图只在用户点击“定位到我”按钮时手动居中。
  // update short textual direction for UI
  if (directionShort) {
    try { directionShort.textContent = bearing !== null ? degToCardinal(bearing) : '-' } catch (e) {}
  }
}

// Calculate bearing (degrees) from point A to B
function calculateBearing(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180
  const toDeg = (r) => (r * 180) / Math.PI
  const φ1 = toRad(lat1)
  const φ2 = toRad(lat2)
  const Δλ = toRad(lon2 - lon1)
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  const θ = Math.atan2(y, x)
  let brng = (toDeg(θ) + 360) % 360
  return brng
}

function degToCardinal(deg) {
  if (deg === null || typeof deg !== 'number' || !Number.isFinite(deg)) return '-'
  const directions = ['北','东北','东','东南','南','西南','西','西北']
  const ix = Math.round(deg / 45) % 8
  return directions[ix]
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
  // Do not clear innerHTML to avoid DOM flicker; reuse cached buttons when possible
  // Show ALL restrooms (do not filter by the top selection)
  const all = csData.slice()
  // If we have a user location, compute distances and sort by closest first. Restrooms without coords go to the end.
  if (userLocation) {
    all.forEach((r) => {
      if (Number.isFinite(r.经度) && Number.isFinite(r.纬度)) {
        r._distanceForSort = calculateDistance(userLocation.latitude, userLocation.longitude, r.纬度, r.经度)
      } else {
        r._distanceForSort = Number.POSITIVE_INFINITY
      }
    })
    all.sort((a, b) => (a._distanceForSort || 0) - (b._distanceForSort || 0))
  }

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

    // build stable key for caching
    const key = `${restroom.校区}||${restroom.楼宇}||${restroom.楼层}||${restroom.卫生间属性}`
    let button = restroomButtonCache.get(key)
    let created = false
    if (!button) {
      button = document.createElement("button")
      button.className = "restroom-btn fade-in"
      button.innerHTML = `
            <div class="restroom-info">
                <span class="restroom-tag">${restroom.校区}</span>
                <span class="restroom-tag">${restroom.楼宇}</span>
                <span class="restroom-tag">${restroom.楼层}楼</span>
                <span class="restroom-tag">${restroom.卫生间属性}</span>
            </div>
            <span class="restroom-distance">-</span>
        `
      // attach click handler once
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
      restroomButtonCache.set(key, button)
      created = true
    }

    // Update distance text in-place to avoid replacing the node
    try {
      const distEl = button.querySelector('.restroom-distance')
      if (distEl) {
        if (userLocation && Number.isFinite(restroom.经度) && Number.isFinite(restroom.纬度)) {
          const distance = restroom._distanceForSort !== undefined && isFinite(restroom._distanceForSort) ? restroom._distanceForSort : calculateDistance(userLocation.latitude, userLocation.longitude, restroom.纬度, restroom.经度)
          const color = getDistanceColor(distance)
          distEl.textContent = `${Math.round(distance)}M`
          distEl.style.color = color
          distEl.style.fontWeight = '600'
        } else {
          distEl.textContent = '-'
          distEl.style.color = ''
          distEl.style.fontWeight = ''
        }
      }
    } catch (e) {}
    // append (or move) into the list in correct order. Using appendChild with existing node will move it.
    restroomsList.appendChild(button)
  })
  // clean up temporary sorting key to avoid mutating source objects
  all.forEach((r) => { try { delete r._distanceForSort } catch (e) {} })
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

  // update building circle color: reset previous and mark this building green
  try {
    if (lastHighlightedBuilding && buildingCircles.has(lastHighlightedBuilding)) {
      const prev = buildingCircles.get(lastHighlightedBuilding)
      prev.setStyle({ color: '#0078d4', fillColor: '#0078d4' })
    }
    if (restroom && buildingCircles.has(restroom.楼宇)) {
      const circle = buildingCircles.get(restroom.楼宇)
      circle.setStyle({ color: '#10b981', fillColor: '#10b981' })
      lastHighlightedBuilding = restroom.楼宇
    }
    // optionally center map on restroom
    if (map && Number.isFinite(restroom.纬度) && Number.isFinite(restroom.经度)) {
      map.setView([restroom.纬度, restroom.经度], Math.max(map.getZoom(), 18))
    }
  } catch (e) {
    console.warn('[Asul] update circle color failed', e)
  }

  // Bring details card into view and center it (avoid jumping to page top)
  try {
    if (detailsCard && detailsCard.scrollIntoView) {
      detailsCard.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  } catch (e) { /* ignore scroll errors */ }
}

function getDistanceColor(distance) {
  // Define distance thresholds (in meters)
  const nearThreshold = 150 // Green for distances <= 150m
  const farThreshold = 500 // Red for distances >= 500m

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
