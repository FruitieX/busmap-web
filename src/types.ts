import { LatLng } from "leaflet";

export interface ApiRoute {
  gtfsId: string;
  longName: string;
  shortName: string;
};

export interface ApiVehicle {
  acc: number;
  desi: string;
  dir: string;
  dl: number;
  drst: number;
  hdg: number;
  jrn: number;
  lat?: number;
  long?: number;
  line: number;
  oday: string;
  odo: number;
  oper: number;
  spd: number;
  start: string;
  tsi: number;
  tst: string;
  veh: number;
}

export interface Route extends ApiRoute {
  polyline?: LatLng[]
};

export interface Vehicle extends ApiVehicle {
  lastUpdate: number;
  latLng?: LatLng;
  dest: string;
};
