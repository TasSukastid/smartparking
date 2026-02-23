export interface Garage {
  id: string;
  slug: string;
  name: string;
  address: string;
  distance: string;
  slotsAvailable: number;
  pricePerHour: string;
  isFull: boolean;
  floors: FloorData[];
  facilities: FacilityData[];
  lat: number;
  lng: number;
  /** REST endpoint that returns ApiParkingResponse — set to enable live data */
  apiUrl?: string;
}

// ── API response types ──────────────────────────────────────────────────────
export interface ApiParkingSpot {
  id: number;
  floor_id: number;
  spot_number: string;
  is_occupied: number;   // 0 = free, 1 = occupied
  camera_url: string | null;
  last_update: string;   // ISO 8601
  floor_name: string;
}

export interface ApiParkingResponse {
  status: string;
  count: number;
  available_count: number;
  occupied_count: number;
  parking_spots: ApiParkingSpot[];
}

// ── Buildings API response types (new nested format) ────────────────────────
export interface ApiBuildingSpot {
  id: number;
  floor_id: number;
  spot_number: string;
  is_occupied: number;
  camera_url: string | null;
  last_update: string;
}

export interface ApiFloor {
  id: number;
  building_id: number;
  floor_name: string;
  total_capacity: number;
  parking_spots: ApiBuildingSpot[];
}

export interface ApiBuilding {
  id: number;
  building_name: string;
  address: string;
  total_floors: number;
  created_at: string;
  latitude: number;
  longitude: number;
  floors: ApiFloor[];
  apiUrl?: string;
}

export interface ApiBuildingsResponse {
  status: string;
  count: number;
  buildings: ApiBuilding[];
}

export interface FloorData {
  level: string;
  status: string;
  progress: number;
  colorClass: {
    bg: string;
    text: string;
    bar: string;
  };
}

export interface FacilityData {
  icon: any;
  label: string;
  status: string;
  colorClass: {
    bg: string;
    text: string;
  };
}
