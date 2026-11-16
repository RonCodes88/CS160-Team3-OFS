"use client";

import "mapbox-gl/dist/mapbox-gl.css";
import type { ReactNode } from "react";
import { Bot, Home, Store } from "lucide-react";
import Map, { Layer, Marker, Source } from "react-map-gl/mapbox";
import { mapBounds, type LngLat } from "./trackingStatus";

type Props = {
  route: LngLat[];
  store: LngLat;
  /** The customer's own delivery point, when known. */
  destination: LngLat | null;
  /** Latest robot location, or null when there is none to show. */
  robot: LngLat | null;
};

function Pin({ label, className, children }: { label: string; className: string; children: ReactNode }) {
  return (
    <span
      role="img"
      aria-label={label}
      className={`inline-flex items-center justify-center rounded-blob border-[3px] border-pencil shadow-hard-sm ${className}`}
    >
      {children}
    </span>
  );
}

/** Mapbox map of a robot trip. It only draws what it is given. */
export function TrackingMap({ route, store, destination, robot }: Props) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
  if (!token) {
    return <p className="p-6 text-center text-lg">The map isn&apos;t configured on this server.</p>;
  }

  return (
    <Map
      mapboxAccessToken={token}
      initialViewState={{ bounds: mapBounds([...route, store, ...(destination ? [destination] : [])]), fitBoundsOptions: { padding: 56 } }}
      mapStyle="mapbox://styles/mapbox/streets-v12"
      style={{ width: "100%", height: "100%" }}
    >
      <Source type="geojson" data={{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: route } }}>
        <Layer
          type="line"
          layout={{ "line-cap": "round", "line-join": "round" }}
          paint={{ "line-color": "#2d5da1", "line-width": 5, "line-opacity": 0.8 }}
        />
      </Source>

      <Marker longitude={store[0]} latitude={store[1]} anchor="center">
        <Pin label="Store" className="h-9 w-9 bg-white">
          <Store aria-hidden strokeWidth={2.5} className="h-5 w-5" />
        </Pin>
      </Marker>
      {destination && (
        <Marker longitude={destination[0]} latitude={destination[1]} anchor="center">
          <Pin label="Your delivery address" className="h-9 w-9 bg-marker text-white">
            <Home aria-hidden strokeWidth={2.5} className="h-5 w-5" />
          </Pin>
        </Marker>
      )}
      {robot && (
        <Marker longitude={robot[0]} latitude={robot[1]} anchor="center">
          <Pin label="Robot" className="h-11 w-11 bg-postit">
            <Bot aria-hidden strokeWidth={2.5} className="h-6 w-6" />
          </Pin>
        </Marker>
      )}
    </Map>
  );
}
