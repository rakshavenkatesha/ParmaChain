// Curated Indian cities (approximate city-centre coordinates) for coarse, privacy-friendly locations.
export const CITIES = [
  { city: "New Delhi", lat: 28.6139, lon: 77.209 },
  { city: "Mumbai", lat: 19.076, lon: 72.8777 },
  { city: "Bengaluru", lat: 12.9716, lon: 77.5946 },
  { city: "Chennai", lat: 13.0827, lon: 80.2707 },
  { city: "Hyderabad", lat: 17.385, lon: 78.4867 },
  { city: "Kolkata", lat: 22.5726, lon: 88.3639 },
  { city: "Pune", lat: 18.5204, lon: 73.8567 },
  { city: "Ahmedabad", lat: 23.0225, lon: 72.5714 },
  { city: "Coimbatore", lat: 11.0168, lon: 76.9558 },
  { city: "Kochi", lat: 9.9312, lon: 76.2673 },
  { city: "Thiruvananthapuram", lat: 8.5241, lon: 76.9366 },
  { city: "Madurai", lat: 9.9252, lon: 78.1198 },
  { city: "Mysuru", lat: 12.2958, lon: 76.6394 },
  { city: "Mangaluru", lat: 12.9141, lon: 74.856 },
  { city: "Visakhapatnam", lat: 17.6868, lon: 83.2185 },
  { city: "Vijayawada", lat: 16.5062, lon: 80.648 },
  { city: "Nagpur", lat: 21.1458, lon: 79.0882 },
  { city: "Jaipur", lat: 26.9124, lon: 75.7873 },
  { city: "Lucknow", lat: 26.8467, lon: 80.9462 },
  { city: "Chandigarh", lat: 30.7333, lon: 76.7794 },
  { city: "Bhopal", lat: 23.2599, lon: 77.4126 },
  { city: "Indore", lat: 22.7196, lon: 75.8577 },
  { city: "Patna", lat: 25.5941, lon: 85.1376 },
  { city: "Bhubaneswar", lat: 20.2961, lon: 85.8245 },
  { city: "Guwahati", lat: 26.1445, lon: 91.7362 },
  { city: "Goa (Panaji)", lat: 15.4909, lon: 73.8278 }
];

export const findCity = (name) => CITIES.find((c) => c.city === name) || null;

/** Nearest curated city to a coordinate (used to coarsen browser geolocation). */
export function nearestCity(lat, lon) {
  let best = null;
  let bestD = Infinity;
  for (const c of CITIES) {
    const d = (c.lat - lat) ** 2 + ((c.lon - lon) * Math.cos((lat * Math.PI) / 180)) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}
