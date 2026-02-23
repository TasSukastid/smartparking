/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  Search,
  Navigation,
  Navigation2,
  Map as MapIcon,
  ArrowLeft,
  MapPin,
  LocateFixed,
  Camera,
  RefreshCw,
  Loader2,
  X,
  ChevronRight,
} from 'lucide-react';
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { motion, AnimatePresence } from 'motion/react';
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  createBrowserRouter,
  RouterProvider,
  Outlet,
  useNavigate,
  useParams,
  useMatch,
  Link,
} from 'react-router-dom';
import {
  Garage,
  ApiParkingResponse,
  ApiParkingSpot,
  FloorData,
  ApiBuildingsResponse,
  ApiBuilding,
} from './types';
import MOCK_BUILDINGS_DATA from './api.json';
import PARKING_FORECAST_RAW from '../parking_forecast_7days.json';

// ── Haversine distance ────────────────────────────────────────────────────────
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): string {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const dist = R * c;
  return dist < 1 ? `${Math.round(dist * 1000)} m` : `${dist.toFixed(1)} km`;
}

// ── Buildings API helpers ─────────────────────────────────────────────────────
function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function normalizeBuildingsResponse(data: ApiBuildingsResponse): ApiParkingResponse {
  const allSpots: ApiParkingSpot[] = [];
  for (const building of data.buildings) {
    for (const floor of building.floors) {
      for (const spot of floor.parking_spots) {
        allSpots.push({ ...spot, floor_name: floor.floor_name });
      }
    }
  }
  const occupied = allSpots.filter((s) => s.is_occupied).length;
  return {
    status: data.status,
    count: allSpots.length,
    available_count: allSpots.length - occupied,
    occupied_count: occupied,
    parking_spots: allSpots,
  };
}

function buildingToGarage(b: ApiBuilding, userLat?: number, userLng?: number): Garage {
  const allSpots = b.floors.flatMap((f) => f.parking_spots);
  const occupied = allSpots.filter((s) => s.is_occupied).length;
  const available = allSpots.length - occupied;
  const dist =
    userLat != null && userLng != null
      ? haversineDistance(userLat, userLng, b.latitude, b.longitude)
      : 'Unknown';
  return {
    id: String(b.id),
    slug: slugify(b.building_name),
    name: b.building_name,
    address: b.address,
    distance: dist,
    slotsAvailable: available,
    pricePerHour: 'Free',
    isFull: allSpots.length > 0 && available === 0,
    lat: b.latitude,
    lng: b.longitude,
    floors: [],
    facilities: [],
    ...(b.apiUrl ? { apiUrl: b.apiUrl } : {}),
  };
}

function buildingsToGarages(
  data: ApiBuildingsResponse,
  userLat?: number,
  userLng?: number,
): Garage[] {
  return data.buildings.map((b) => buildingToGarage(b, userLat, userLng));
}

function findGarageBySlug(
  slug: string,
  userLat?: number,
  userLng?: number,
): Garage | undefined {
  const building = (MOCK_BUILDINGS_DATA as unknown as ApiBuildingsResponse).buildings.find(
    (b) => slugify(b.building_name) === slug,
  );
  return building ? buildingToGarage(building, userLat, userLng) : undefined;
}

// ── Flat-API helpers ──────────────────────────────────────────────────────────
function transformApiToFloors(data: ApiParkingResponse): FloorData[] {
  const floorMap = new Map<string, { total: number; occupied: number }>();
  for (const spot of data.parking_spots) {
    const f = floorMap.get(spot.floor_name) ?? { total: 0, occupied: 0 };
    f.total++;
    if (spot.is_occupied) f.occupied++;
    floorMap.set(spot.floor_name, f);
  }
  return Array.from(floorMap.entries()).map(([, { total, occupied }], i) => {
    const pct = total > 0 ? Math.round((occupied / total) * 100) : 0;
    const available = total - occupied;
    const colorClass: FloorData['colorClass'] =
      pct >= 95
        ? { bg: 'bg-red-50', text: 'text-red-500', bar: 'bg-red-500' }
        : pct >= 70
          ? { bg: 'bg-orange-50', text: 'text-orange-500', bar: 'bg-orange-500' }
          : { bg: 'bg-emerald-50', text: 'text-emerald-500', bar: 'bg-emerald-500' };
    return {
      level: String(i + 1),
      status: pct >= 100 ? 'Full' : `${available} Spots`,
      progress: pct,
      colorClass,
    };
  });
}

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

// ── ParkingSpotGrid ───────────────────────────────────────────────────────────
const ParkingSpotGrid = ({ spots }: { spots: ApiParkingSpot[] }) => {
  const floors = Array.from(
    spots.reduce((map, s) => {
      const arr = map.get(s.floor_name) ?? [];
      arr.push(s);
      map.set(s.floor_name, arr);
      return map;
    }, new Map<string, ApiParkingSpot[]>()),
  );

  return (
    <div className="space-y-4">
      {floors.map(([floorName, floorSpots]) => (
        <div key={floorName}>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
            {floorName}
          </p>
          <div className="grid grid-cols-4 gap-2">
            {floorSpots.map((spot) => (
              <motion.div
                key={spot.id}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className={`relative flex flex-col items-center justify-center rounded-xl p-2 border text-center cursor-default select-none ${
                  spot.is_occupied
                    ? 'bg-red-50 border-red-200'
                    : 'bg-emerald-50 border-emerald-200'
                }`}
              >
                <span
                  className={`text-[10px] font-black ${
                    spot.is_occupied ? 'text-red-600' : 'text-emerald-700'
                  }`}
                >
                  {spot.spot_number}
                </span>
                <span
                  className={`text-[9px] font-semibold mt-0.5 ${
                    spot.is_occupied ? 'text-red-400' : 'text-emerald-500'
                  }`}
                >
                  {spot.is_occupied ? 'Taken' : 'Free'}
                </span>
                {spot.camera_url && (
                  <a
                    href={spot.camera_url}
                    target="_blank"
                    rel="noreferrer"
                    className="absolute top-1 right-1 text-slate-400 hover:text-primary transition-colors"
                    title="View camera"
                  >
                    <Camera size={10} />
                  </a>
                )}
              </motion.div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

// ── AppNavbar ─────────────────────────────────────────────────────────────────
const AppNavbar = () => {
  const isDetail = useMatch('/garage/:slug');

  return (
    <header className="bg-white/80 backdrop-blur-md sticky top-0 z-50 border-b border-slate-100">
      <div className="w-full px-4 h-14 flex items-center gap-3">
        {isDetail ? (
          <Link
            to="/"
            className="p-2 -ml-2 rounded-full hover:bg-slate-100 transition-colors text-slate-600"
          >
            <ArrowLeft size={20} />
          </Link>
        ) : (
          <div className="p-2 -ml-2 rounded-full bg-primary/10 text-primary">
            <MapIcon size={20} />
          </div>
        )}
        <div className="flex-1">
          <h1 className="text-base font-black text-slate-900 leading-tight">
            {isDetail ? 'Parking Details' : 'HackBoi ParkFlow'}
          </h1>
          {!isDetail && (
            <p className="text-[10px] text-slate-400 font-medium leading-tight">
              Flow with The HackBoi's real-time parking
            </p>
          )}
        </div>
      </div>
    </header>
  );
};

// ── GarageListItem ────────────────────────────────────────────────────────────
const GarageListItem = ({ garage, index }: { garage: Garage; index: number }) => {
  const statusColor = garage.isFull
    ? 'text-red-500 bg-red-50 border-red-200'
    : garage.slotsAvailable < 5
      ? 'text-orange-500 bg-orange-50 border-orange-200'
      : 'text-emerald-600 bg-emerald-50 border-emerald-200';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.06 }}
    >
      <Link
        to={`/garage/${garage.slug}`}
        className="block bg-white rounded-2xl p-4 shadow-sm border border-slate-100 hover:shadow-md hover:border-primary/20 transition-all duration-200 active:scale-[0.98]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${statusColor}`}
              >
                {garage.isFull ? 'FULL' : `${garage.slotsAvailable} FREE`}
              </span>
            </div>
            <h3 className="font-black text-slate-900 text-sm leading-tight truncate mt-1">
              {garage.name}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
              <MapPin size={10} className="shrink-0" />
              <span className="truncate">{garage.address}</span>
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-xs font-bold text-primary">{garage.distance}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">{garage.pricePerHour}</p>
          </div>
        </div>

        {garage.floors.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {garage.floors.map((floor) => (
              <div key={floor.level} className="flex items-center gap-2">
                <span className="text-[10px] text-slate-400 w-10 shrink-0">
                  Fl.{floor.level}
                </span>
                <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${floor.progress}%` }}
                    transition={{ duration: 0.6, delay: index * 0.06 + 0.2 }}
                    className={`h-full rounded-full ${floor.colorClass.bar}`}
                  />
                </div>
                <span
                  className={`text-[10px] font-semibold w-12 text-right ${floor.colorClass.text}`}
                >
                  {floor.status}
                </span>
              </div>
            ))}
          </div>
        )}

        {garage.facilities.length > 0 && (
          <div className="mt-3 flex items-center gap-1.5 flex-wrap">
            {garage.facilities.map((fac) => (
              <span
                key={fac.label}
                className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${fac.colorClass.bg} ${fac.colorClass.text}`}
              >
                {fac.icon}
                {fac.label}
              </span>
            ))}
          </div>
        )}
      </Link>
    </motion.div>
  );
};

// ── GarageListView ─────────────────────────────────────────────────────────────
const GarageListView = () => {
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'requesting' | 'granted' | 'denied'>('idle');
  const [garages, setGarages] = useState<Garage[]>(() =>
    buildingsToGarages(MOCK_BUILDINGS_DATA as unknown as ApiBuildingsResponse),
  );
  const [search, setSearch] = useState('');
  // slug → live available count
  const [liveAvailable, setLiveAvailable] = useState<Record<string, number>>({});

  const requestGps = useCallback(() => {
    if (!navigator.geolocation) {
      setGpsStatus('denied');
      return;
    }
    setGpsStatus('requesting');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        sessionStorage.setItem('parkflow_lat', String(lat));
        sessionStorage.setItem('parkflow_lng', String(lng));
        setGpsStatus('granted');
        setGarages(
          buildingsToGarages(MOCK_BUILDINGS_DATA as unknown as ApiBuildingsResponse, lat, lng),
        );
      },
      () => setGpsStatus('denied'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, []);

  useEffect(() => {
    requestGps();
  }, [requestGps]);

  // Subscribe to live data for every building that has an apiUrl
  useEffect(() => {
    const mockData = MOCK_BUILDINGS_DATA as unknown as ApiBuildingsResponse;
    const cleanups: (() => void)[] = [];

    for (const building of mockData.buildings) {
      if (!building.apiUrl) continue;
      const slug = slugify(building.building_name);
      const apiUrl = building.apiUrl;

      const handleData = (json: unknown) => {
        let available: number | undefined;
        if (json && typeof json === 'object' && 'available_count' in json) {
          available = (json as ApiParkingResponse).available_count;
        } else if (json && typeof json === 'object' && 'buildings' in json) {
          const norm = normalizeBuildingsResponse(json as ApiBuildingsResponse);
          available = norm.available_count;
        }
        if (available !== undefined) {
          setLiveAvailable((prev) => ({ ...prev, [slug]: available as number }));
        }
      };

      if (apiUrl.includes('stream')) {
        const es = new EventSource(apiUrl);
        es.onmessage = (e) => { try { handleData(JSON.parse(e.data)); } catch { /* ignore */ } };
        cleanups.push(() => es.close());
      } else {
        const poll = async () => {
          try {
            const res = await fetch(apiUrl);
            if (res.ok) handleData(await res.json());
          } catch { /* silent */ }
        };
        poll();
        const id = setInterval(poll, 5000);
        cleanups.push(() => clearInterval(id));
      }
    }
    return () => cleanups.forEach((fn) => fn());
  }, []);

  // Merge live counts into garage list
  const displayGarages = garages.map((g) =>
    g.slug in liveAvailable
      ? { ...g, slotsAvailable: liveAvailable[g.slug], isFull: liveAvailable[g.slug] === 0 }
      : g,
  );

  const filtered = displayGarages.filter(
    (g) =>
      g.name.toLowerCase().includes(search.toLowerCase()) ||
      g.address.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="flex-1 overflow-y-auto">
      {/* GPS Banner */}
      <AnimatePresence>
        {gpsStatus === 'requesting' && (
          <motion.div
            key="requesting"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-blue-50 border-b border-blue-100 overflow-hidden"
          >
            <div className="w-full px-4 py-2 flex items-center gap-2 text-blue-600 text-xs font-semibold">
              <Loader2 size={13} className="animate-spin shrink-0" />
              Getting your location...
            </div>
          </motion.div>
        )}
        {gpsStatus === 'granted' && (
          <motion.div
            key="granted"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-emerald-50 border-b border-emerald-100 overflow-hidden"
          >
            <div className="w-full px-4 py-2 flex items-center gap-2 text-emerald-600 text-xs font-semibold">
              <LocateFixed size={13} className="shrink-0" />
              Showing distances from your location
            </div>
          </motion.div>
        )}
        {gpsStatus === 'denied' && (
          <motion.div
            key="denied"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-amber-50 border-b border-amber-100 overflow-hidden"
          >
            <div className="w-full px-4 py-2 flex items-center gap-2 text-amber-600 text-xs font-semibold">
              <Navigation size={13} className="shrink-0" />
              Location unavailable -{' '}
              <button onClick={requestGps} className="underline">
                retry
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="w-full px-3 py-4 space-y-4">
        {/* Search */}
        <div className="relative">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="text"
            placeholder="Search parking..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
          />
        </div>

        {/* List */}
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-sm">No results found</div>
        ) : (
          <div className="space-y-3">
            {filtered.map((g, i) => (
              <React.Fragment key={g.id}>
                <GarageListItem garage={g} index={i} />
              </React.Fragment>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ── Map helpers ──────────────────────────────────────────────────────────────
const MapController = ({
  position,
  follow,
}: {
  position: [number, number] | null;
  follow: boolean;
}) => {
  const map = useMap();
  useEffect(() => {
    if (follow && position) map.panTo(position, { animate: true, duration: 0.7 });
  }, [position, follow, map]);
  return null;
};

const RecenterControl = ({
  lat,
  lng,
  onRecenter,
}: {
  lat: number;
  lng: number;
  onRecenter?: () => void;
}) => {
  const map = useMap();
  return (
    <button
      onClick={() => {
        map.flyTo([lat, lng], 17, { duration: 1 });
        onRecenter?.();
      }}
      className="absolute bottom-4 right-4 z-[1000] bg-white shadow-lg rounded-xl p-2.5 border border-slate-200 hover:bg-primary/10 hover:border-primary/30 transition-colors"
      title="Center on my location"
    >
      <LocateFixed size={18} className="text-primary" />
    </button>
  );
};

// ── NavigationModal ──────────────────────────────────────────────────────────
const userDivIcon = L.divIcon({
  html: `<div style="width:16px;height:16px;background:#3b82f6;border:3px solid white;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.35)"></div>`,
  className: '',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

const garageDivIcon = L.divIcon({
  html: `<div style="display:flex;align-items:center;justify-content:center">
    <svg viewBox="0 0 24 24" width="36" height="36"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="#ef4444"/></svg>
  </div>`,
  className: '',
  iconSize: [36, 36],
  iconAnchor: [18, 36],
});

type OsrmStep = {
  distance: number;
  duration: number;
  name: string;
  maneuver: { type: string; modifier?: string; location: [number, number] };
};
type OsrmRoute = {
  distance: number;
  duration: number;
  geometry: { coordinates: [number, number][] };
  legs: [{ steps: OsrmStep[] }];
};

function formatStep(step: OsrmStep): string {
  const { type, modifier } = step.maneuver;
  const name = step.name;
  if (type === 'depart') return name ? `Start on ${name}` : 'Depart';
  if (type === 'arrive') return 'Arrive at destination';
  if (modifier) {
    const dir = modifier.replace('-', ' ');
    const dirCap = dir.charAt(0).toUpperCase() + dir.slice(1);
    return name ? `${dirCap} onto ${name}` : dirCap;
  }
  return name ? `Continue on ${name}` : 'Continue';
}

function fmtDist(m: number) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}
function fmtTime(s: number) {
  const min = Math.round(s / 60);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)}h ${min % 60}m`;
}

type NavModalProps = {
  garage: Garage;
  userLat?: number;
  userLng?: number;
  onClose: () => void;
};

const NavigationModal = ({ garage, userLat: initLat, userLng: initLng, onClose }: NavModalProps) => {
  const hasInitLoc = initLat != null && initLng != null;

  // route & loading
  const [route, setRoute] = useState<OsrmRoute | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);

  // navigation mode
  const [navMode, setNavMode] = useState<'preview' | 'navigating'>('preview');
  const [livePos, setLivePos] = useState<[number, number] | null>(
    hasInitLoc ? [initLat!, initLng!] : null,
  );
  const [stepIdx, setStepIdx] = useState(0);
  const [followUser, setFollowUser] = useState(true);
  const [rerouting, setRerouting] = useState(false);
  const watchRef = useRef<number | null>(null);
  const rerouteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── fetch route ────────────────────────────────────────────────────────────
  const fetchRoute = useCallback(
    async (fromLat: number, fromLng: number) => {
      setRouteLoading(true);
      setRouteError(null);
      try {
        const res = await fetch(
          `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${garage.lng},${garage.lat}?overview=full&geometries=geojson&steps=true`,
        );
        const data = await res.json();
        if (data.routes?.[0]) {
          setRoute(data.routes[0]);
          setStepIdx(0);
        } else setRouteError('No route found');
      } catch {
        setRouteError('Could not load route');
      } finally {
        setRouteLoading(false);
        setRerouting(false);
      }
    },
    [garage.lat, garage.lng],
  );

  useEffect(() => {
    if (hasInitLoc) fetchRoute(initLat!, initLng!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── start / stop GPS watch ─────────────────────────────────────────────────
  const stopWatch = useCallback(() => {
    if (watchRef.current != null) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    }
    if (rerouteTimer.current) clearTimeout(rerouteTimer.current);
  }, []);

  const startNavigation = useCallback(() => {
    setNavMode('navigating');
    setFollowUser(true);
    if (!navigator.geolocation) return;
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const newPos: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        setLivePos(newPos);
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 1500, timeout: 10000 },
    );
  }, []);

  const stopNavigation = useCallback(() => {
    stopWatch();
    setNavMode('preview');
    setFollowUser(false);
  }, [stopWatch]);

  useEffect(() => () => stopWatch(), [stopWatch]);

  // ── auto-advance step when close to next maneuver ─────────────────────────
  useEffect(() => {
    if (!livePos || !route || navMode !== 'navigating') return;
    const steps = route.legs[0]?.steps ?? [];
    // Check arrival at destination
    const destDist =
      Math.hypot(livePos[0] - garage.lat, livePos[1] - garage.lng) * 111_000;
    if (destDist < 25) {
      stopWatch();
      setNavMode('preview');
      return;
    }
    // Advance to next step if within 35 m of next maneuver
    const nextStep = steps[stepIdx + 1];
    if (nextStep) {
      const [nLng, nLat] = nextStep.maneuver.location;
      const d = Math.hypot(livePos[0] - nLat, livePos[1] - nLng) * 111_000;
      if (d < 35) setStepIdx((i) => i + 1);
    }
    // Re-route if far from current step maneuver (>120 m)
    const curStep = steps[stepIdx];
    if (curStep && !rerouting) {
      const [cLng, cLat] = curStep.maneuver.location;
      const offRoute = Math.hypot(livePos[0] - cLat, livePos[1] - cLng) * 111_000;
      if (offRoute > 120) {
        setRerouting(true);
        if (rerouteTimer.current) clearTimeout(rerouteTimer.current);
        rerouteTimer.current = setTimeout(() => {
          fetchRoute(livePos[0], livePos[1]);
        }, 1500);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [livePos]);

  // ── derived values ─────────────────────────────────────────────────────────
  const steps = route?.legs[0]?.steps ?? [];
  const currentStep = steps[stepIdx];
  const nextStep = steps[stepIdx + 1];
  const routePositions: [number, number][] =
    route?.geometry.coordinates.map(([lng, lat]) => [lat, lng]) ?? [];
  const userMarkerPos = livePos ?? (hasInitLoc ? [initLat!, initLng!] as [number,number] : null);
  const mapCenter: [number, number] = userMarkerPos
    ? navMode === 'navigating'
      ? userMarkerPos
      : [(userMarkerPos[0] + garage.lat) / 2, (userMarkerPos[1] + garage.lng) / 2]
    : [garage.lat, garage.lng];

  const isNavigating = navMode === 'navigating';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-end"
      style={{ background: isNavigating ? 'transparent' : 'rgba(0,0,0,0.5)' }}
      onClick={(e) => !isNavigating && e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="flex flex-col bg-white w-full max-w-md rounded-t-3xl overflow-hidden"
        style={{ height: isNavigating ? '100dvh' : '90dvh', borderRadius: isNavigating ? 0 : undefined }}
      >
        {/* ── NAVIGATING header — current step overlay ── */}
        {isNavigating && currentStep && (
          <div className="shrink-0 bg-primary text-white px-4 pt-10 pb-4 shadow-lg">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-semibold opacity-70 uppercase tracking-wider mb-0.5">
                  {fmtDist(currentStep.distance)}
                </p>
                <h3 className="font-black text-base leading-tight">
                  {formatStep(currentStep)}
                </h3>
                {nextStep && (
                  <p className="text-[10px] opacity-70 mt-1 font-semibold">
                    Then: {formatStep(nextStep)}
                  </p>
                )}
              </div>
              {rerouting && (
                <div className="flex items-center gap-1 text-[10px] font-bold bg-white/20 rounded-lg px-2 py-1 shrink-0">
                  <Loader2 size={10} className="animate-spin" /> Re-routing
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── PREVIEW header ── */}
        {!isNavigating && (
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 shrink-0">
            <div className="flex-1 min-w-0">
              <h3 className="font-black text-slate-900 text-sm truncate">{garage.name}</h3>
              {routeLoading && (
                <p className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1 font-semibold">
                  <Loader2 size={9} className="animate-spin" /> Calculating route...
                </p>
              )}
              {route && !routeLoading && (
                <p className="text-[10px] text-primary font-bold mt-0.5">
                  {fmtDist(route.distance)} · {fmtTime(route.duration)} by car
                </p>
              )}
              {!hasInitLoc && (
                <p className="text-[10px] text-amber-500 font-semibold mt-0.5">
                  Enable location for turn-by-turn routing
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              className="ml-3 p-2 rounded-full hover:bg-slate-100 text-slate-500 transition-colors shrink-0"
            >
              <X size={18} />
            </button>
          </div>
        )}

        {/* ── Map ── */}
        <div className="flex-1 relative min-h-0">
          <MapContainer
            center={mapCenter}
            zoom={isNavigating ? 17 : (hasInitLoc ? 13 : 16)}
            style={{ height: '100%', width: '100%' }}
            zoomControl={!isNavigating}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <Marker position={[garage.lat, garage.lng]} icon={garageDivIcon} />
            {userMarkerPos && <Marker position={userMarkerPos} icon={userDivIcon} />}
            {routePositions.length > 0 && (
              <Polyline positions={routePositions} color="#3b82f6" weight={5} opacity={0.85} />
            )}
            {userMarkerPos && (
              <RecenterControl
                lat={userMarkerPos[0]}
                lng={userMarkerPos[1]}
                onRecenter={() => setFollowUser(true)}
              />
            )}
            <MapController position={userMarkerPos} follow={isNavigating && followUser} />
          </MapContainer>
        </div>

        {/* ── PREVIEW steps list ── */}
        {!isNavigating && steps.length > 1 && (
          <div className="shrink-0 max-h-44 overflow-y-auto border-t border-slate-100">
            <div className="px-4 py-2 space-y-0.5">
              {steps.slice(0, -1).map((step, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2.5 py-1.5 border-b border-slate-50 last:border-0"
                >
                  <span className="text-[10px] font-bold text-primary bg-primary/10 rounded-full w-5 h-5 flex items-center justify-center shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-700 font-semibold leading-snug">
                      {formatStep(step)}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5">{fmtDist(step.distance)}</p>
                  </div>
                  <ChevronRight size={12} className="text-slate-300 shrink-0 mt-1" />
                </div>
              ))}
              <div className="flex items-start gap-2.5 py-1.5">
                <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 rounded-full w-5 h-5 flex items-center justify-center shrink-0 mt-0.5">
                  <MapPin size={9} />
                </span>
                <p className="text-xs text-emerald-700 font-semibold">Arrive at {garage.name}</p>
              </div>
            </div>
          </div>
        )}

        {/* ── PREVIEW — Start button ── */}
        {!isNavigating && (
          <div className="shrink-0 px-4 py-3 border-t border-slate-100">
            {routeError && (
              <p className="text-xs text-red-500 font-semibold text-center mb-2">{routeError}</p>
            )}
            <button
              onClick={startNavigation}
              disabled={!route || !hasInitLoc}
              className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-primary text-white font-bold text-sm hover:bg-primary/90 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Navigation2 size={16} />
              {!hasInitLoc ? 'Enable GPS to navigate' : routeLoading ? 'Loading route...' : 'Start Navigation'}
            </button>
          </div>
        )}

        {/* ── NAVIGATING bottom bar ── */}
        {isNavigating && route && (
          <div className="shrink-0 bg-white border-t border-slate-100 px-4 py-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-black text-slate-900">
                {fmtDist(route.distance)}
              </p>
              <p className="text-[10px] text-slate-400 font-semibold">
                {fmtTime(route.duration)} · via car
              </p>
            </div>
            <button
              onClick={stopNavigation}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-500 text-white font-bold text-xs hover:bg-red-600 transition-colors"
            >
              <X size={13} /> Stop
            </button>
            <button
              onClick={onClose}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 text-slate-600 font-bold text-xs hover:bg-slate-200 transition-colors"
            >
              Exit
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
};

// ── OccupancyForecast ────────────────────────────────────────────────────────
const DAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;
type DayName = (typeof DAY_NAMES)[number];

const DAY_SHORT: Record<DayName, string> = {
  Monday: 'Mon',
  Tuesday: 'Tue',
  Wednesday: 'Wed',
  Thursday: 'Thu',
  Friday: 'Fri',
  Saturday: 'Sat',
  Sunday: 'Sun',
};

type ForecastJson = {
  days: Record<DayName, { date: string; hourly: Record<string, number> }>;
};
const FORECAST = PARKING_FORECAST_RAW as unknown as ForecastJson;

function getTodayDayName(): DayName {
  const idx = new Date().getDay(); // 0 = Sun, 1 = Mon … 6 = Sat
  return DAY_NAMES[idx === 0 ? 6 : idx - 1];
}

const OccupancyForecast = () => {
  const todayName = getTodayDayName();
  const [selectedDay, setSelectedDay] = useState<DayName>(todayName);
  const [hoveredHour, setHoveredHour] = useState<number | null>(null);

  const currentHour = new Date().getHours();
  const dayData = FORECAST.days[selectedDay];
  const hours = Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    value: dayData?.hourly[String(i)] ?? 0,
  }));

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 }}
      className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-black text-slate-800 text-sm">Occupancy Forecast</h3>
          <p className="text-[10px] text-slate-400 mt-0.5">
            {dayData?.date ?? ''} &middot; 24-hour prediction
          </p>
        </div>
        <select
          value={selectedDay}
          onChange={(e) => setSelectedDay(e.target.value as DayName)}
          className="text-xs font-semibold text-slate-700 bg-slate-100 border-0 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer"
        >
          {DAY_NAMES.map((day) => (
            <option key={day} value={day}>
              {DAY_SHORT[day]}{day === todayName ? ' · Today' : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Histogram */}
      <div className="relative pl-6">
        {/* Y-axis labels */}
        <div className="absolute left-0 top-0 h-[96px] flex flex-col justify-between pointer-events-none">
          <span className="text-[8px] text-slate-300 leading-none">100%</span>
          <span className="text-[8px] text-slate-300 leading-none">50%</span>
          <span className="text-[8px] text-slate-300 leading-none">0%</span>
        </div>

        {/* Bars area */}
        <div className="relative h-[96px] flex items-end gap-px">
          {/* Reference lines */}
          <div
            className="absolute w-full border-t border-dashed border-slate-100 pointer-events-none"
            style={{ bottom: '50%' }}
          />
          <div
            className="absolute w-full border-t border-dashed border-red-100 pointer-events-none"
            style={{ bottom: '80%' }}
          />

          {hours.map(({ hour, value }) => {
            const isToday = selectedDay === todayName;
            const isPast = isToday && hour < currentHour;
            const isCurrent = isToday && hour === currentHour;
            const barColor =
              value >= 80
                ? isCurrent
                  ? 'bg-red-500'
                  : isPast
                    ? 'bg-red-200'
                    : 'bg-red-400'
                : value >= 50
                  ? isCurrent
                    ? 'bg-orange-500'
                    : isPast
                      ? 'bg-orange-200'
                      : 'bg-orange-400'
                  : isCurrent
                    ? 'bg-emerald-500'
                    : isPast
                      ? 'bg-emerald-200'
                      : 'bg-emerald-400';

            return (
              <div
                key={hour}
                className="flex-1 flex flex-col justify-end h-full relative group cursor-default"
                onMouseEnter={() => setHoveredHour(hour)}
                onMouseLeave={() => setHoveredHour(null)}
              >
                {hoveredHour === hour && (
                  <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[9px] font-bold rounded px-1.5 py-0.5 whitespace-nowrap z-10 pointer-events-none shadow-lg">
                    {hour}:00 &mdash; {value.toFixed(0)}%
                  </div>
                )}
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: `${Math.max(value, value > 0 ? 2 : 0)}%` }}
                  transition={{ duration: 0.4, delay: hour * 0.012 }}
                  className={`w-full rounded-t-sm ${barColor} ${
                    isCurrent ? 'ring-1 ring-slate-500 ring-offset-0' : ''
                  }`}
                />
              </div>
            );
          })}
        </div>

        {/* X-axis labels */}
        <div className="flex mt-1">
          {hours.map(({ hour }) => (
            <div key={hour} className="flex-1 text-center">
              {[0, 6, 12, 18, 23].includes(hour) && (
                <span className="text-[8px] text-slate-400 font-medium">
                  {hour === 0
                    ? '0'
                    : hour === 12
                      ? '12'
                      : hour === 23
                        ? '23'
                        : String(hour)}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-end gap-3 mt-2.5">
        <span className="flex items-center gap-1 text-[9px] text-slate-400 font-semibold">
          <span className="w-2 h-2 rounded-sm bg-emerald-400 inline-block" />
          Low
        </span>
        <span className="flex items-center gap-1 text-[9px] text-slate-400 font-semibold">
          <span className="w-2 h-2 rounded-sm bg-orange-400 inline-block" />
          Medium
        </span>
        <span className="flex items-center gap-1 text-[9px] text-slate-400 font-semibold">
          <span className="w-2 h-2 rounded-sm bg-red-400 inline-block" />
          High
        </span>
      </div>
    </motion.div>
  );
};

// ── GarageDetailView ───────────────────────────────────────────────────────────
const GarageDetailView = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();

  const [userLat] = useState<number | undefined>(() => {
    const v = sessionStorage.getItem('parkflow_lat');
    return v ? parseFloat(v) : undefined;
  });
  const [userLng] = useState<number | undefined>(() => {
    const v = sessionStorage.getItem('parkflow_lng');
    return v ? parseFloat(v) : undefined;
  });

  const garage = slug ? findGarageBySlug(slug, userLat, userLng) : undefined;

  const [showNav, setShowNav] = useState(false);
  const [apiData, setApiData] = useState<ApiParkingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Manual refresh (fetch once, used when no SSE)
  const fetchOnce = useCallback(async () => {
    if (!slug) return;
    const mockData = MOCK_BUILDINGS_DATA as unknown as ApiBuildingsResponse;
    const matchedBuilding = mockData.buildings.find(
      (b) => slugify(b.building_name) === slug,
    );
    const apiUrl = matchedBuilding?.apiUrl;
    setLoading(true);
    setError(null);
    try {
      if (apiUrl) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(apiUrl, { signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        setApiData('buildings' in json
          ? normalizeBuildingsResponse(json as ApiBuildingsResponse)
          : json as ApiParkingResponse);
        setLastUpdated(new Date());
      } else {
        throw new Error('no apiUrl');
      }
    } catch (e) {
      if (matchedBuilding) {
        setApiData(normalizeBuildingsResponse({ ...mockData, buildings: [matchedBuilding] }));
        setLastUpdated(new Date());
      }
      if (e instanceof Error && e.message !== 'no apiUrl' && e.name !== 'AbortError') {
        setError(`Live data unavailable: ${e.message}`);
      }
    } finally {
      setLoading(false);
    }
  }, [slug]);

  // SSE stream or polling, depending on endpoint name
  useEffect(() => {
    if (!slug) return;
    const mockData = MOCK_BUILDINGS_DATA as unknown as ApiBuildingsResponse;
    const matchedBuilding = mockData.buildings.find(
      (b) => slugify(b.building_name) === slug,
    );
    const apiUrl = matchedBuilding?.apiUrl;

    // Load mock data immediately so screen isn't blank
    if (matchedBuilding) {
      setApiData(normalizeBuildingsResponse({ ...mockData, buildings: [matchedBuilding] }));
      setLastUpdated(new Date());
      setLoading(false);
    }

    if (!apiUrl) return;

    if (apiUrl.includes('stream')) {
      // SSE — server pushes updates
      const es = new EventSource(apiUrl);
      es.onopen = () => setError(null);
      es.onmessage = (e) => {
        try {
          const json = JSON.parse(e.data);
          setApiData('buildings' in json
            ? normalizeBuildingsResponse(json as ApiBuildingsResponse)
            : json as ApiParkingResponse);
          setLastUpdated(new Date());
          setLoading(false);
        } catch { /* ignore malformed */ }
      };
      es.onerror = () => setError(null); // keep showing mock, stay silent
      return () => es.close();
    } else {
      // Regular JSON — poll every 2 s
      fetchOnce();
      const id = setInterval(fetchOnce, 2000);
      return () => clearInterval(id);
    }
  }, [slug, fetchOnce]);

  if (!garage) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-slate-500 p-8">
        <MapPin size={40} className="text-slate-300" />
        <p className="text-sm font-semibold">Parking not found</p>
        <button
          onClick={() => navigate('/')}
          className="text-primary text-sm font-bold underline"
        >
          Back to list
        </button>
      </div>
    );
  }

  const displayFloors = apiData ? transformApiToFloors(apiData) : garage.floors;
  const totalSpots = apiData ? apiData.count : null;
  const availableSpots = apiData ? apiData.available_count : garage.slotsAvailable;

  const statusColor =
    garage.isFull
      ? 'text-red-500 bg-red-50'
      : availableSpots < 5
        ? 'text-orange-500 bg-orange-50'
        : 'text-emerald-600 bg-emerald-50';

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="w-full px-3 py-4 space-y-4">
        {/* Hero card */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <h2 className="font-black text-slate-900 text-lg leading-tight">{garage.name}</h2>
              <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                <MapPin size={11} className="shrink-0" />
                {garage.address}
              </p>
            </div>
            <span className={`text-xs font-bold px-3 py-1 rounded-full shrink-0 ${statusColor}`}>
              {garage.isFull ? 'FULL' : `${availableSpots} Free`}
            </span>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3 text-center">
            <div className="bg-slate-50 rounded-xl p-2.5">
              <p className="text-lg font-black text-slate-900">{availableSpots}</p>
              <p className="text-[10px] text-slate-400 font-semibold mt-0.5">Available</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-2.5">
              <p className="text-lg font-black text-slate-900">{totalSpots ?? '-'}</p>
              <p className="text-[10px] text-slate-400 font-semibold mt-0.5">Total</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-2.5">
              <p className="text-lg font-black text-slate-900">{garage.distance}</p>
              <p className="text-[10px] text-slate-400 font-semibold mt-0.5">Distance</p>
            </div>
          </div>

          {/* Navigate button */}
          <button
            onClick={() => setShowNav(true)}
            className="mt-4 flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-primary text-white font-bold text-sm hover:bg-primary/90 active:scale-[0.98] transition-all"
          >
            <Navigation2 size={16} />
            Navigate
          </button>
        </motion.div>

        {/* Live spots card */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-black text-slate-800 text-sm">Live Spot Map</h3>
            <div className="flex items-center gap-2">
              {lastUpdated && (
                <span className="text-[10px] text-slate-400">
                  {timeAgo(lastUpdated.toISOString())}
                </span>
              )}
              <button
                onClick={fetchOnce}
                disabled={loading}
                className="p-1.5 rounded-lg bg-slate-100 hover:bg-primary/10 text-slate-500 hover:text-primary transition-colors disabled:opacity-50"
              >
                {loading ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <RefreshCw size={13} />
                )}
              </button>
            </div>
          </div>

          {loading && !apiData && (
            <div className="flex items-center justify-center py-8 gap-2 text-slate-400 text-sm">
              <Loader2 size={16} className="animate-spin" />
              Loading spots...
            </div>
          )}

          {error && (
            <div className="text-center py-6 text-red-500 text-xs font-semibold">
              {error} -{' '}
              <button onClick={fetchOnce} className="underline">
                retry
              </button>
            </div>
          )}

          {apiData && !loading && <ParkingSpotGrid spots={apiData.parking_spots} />}

          {/* Floor progress bars */}
          {displayFloors.length > 0 && (
            <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                By Floor
              </p>
              {displayFloors.map((floor) => (
                <div key={floor.level} className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-400 w-14 shrink-0 font-semibold">
                    Floor {floor.level}
                  </span>
                  <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${floor.progress}%` }}
                      transition={{ duration: 0.6 }}
                      className={`h-full rounded-full ${floor.colorClass.bar}`}
                    />
                  </div>
                  <span
                    className={`text-[10px] font-bold w-16 text-right ${floor.colorClass.text}`}
                  >
                    {floor.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </motion.div>

        {/* Occupancy Forecast */}
        <OccupancyForecast />

        {/* Navigation Modal */}
        <AnimatePresence>
          {showNav && (
            <NavigationModal
              garage={garage}
              userLat={userLat}
              userLng={userLng}
              onClose={() => setShowNav(false)}
            />
          )}
        </AnimatePresence>

        {/* Facilities */}
        {garage.facilities.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100"
          >
            <h3 className="font-black text-slate-800 text-sm mb-3">Facilities</h3>
            <div className="grid grid-cols-2 gap-2">
              {garage.facilities.map((fac) => (
                <div
                  key={fac.label}
                  className={`flex items-center gap-2 rounded-xl p-3 ${fac.colorClass.bg}`}
                >
                  <span className={fac.colorClass.text}>{fac.icon}</span>
                  <div>
                    <p className={`text-xs font-bold ${fac.colorClass.text}`}>{fac.label}</p>
                    <p className="text-[10px] text-slate-400">{fac.status}</p>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
};

// ── Layout ─────────────────────────────────────────────────────────────────────
const Layout = () => (
  <div className="min-h-screen bg-slate-50 flex flex-col">
    <AppNavbar />
    <Outlet />
  </div>
);

// ── Router ────────────────────────────────────────────────────────────────────
const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <GarageListView /> },
      { path: 'garage/:slug', element: <GarageDetailView /> },
      { path: '*', element: <GarageListView /> },
    ],
  },
]);

// ── App ────────────────────────────────────────────────────────────────────────
export default function App() {
  return <RouterProvider router={router} />;
}
