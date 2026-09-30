export type Coordenadas = { latitude: number; longitude: number };

const RAIO_DA_TERRA_KM = 6371;

// Fórmula de Haversine: distância em linha reta sobre a superfície da Terra,
// arredondada em 1 casa decimal (ex.: 1.2 km)
export function distanciaKm(a: Coordenadas, b: Coordenadas) {
  const rad = (graus: number) => (graus * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  const km = 2 * RAIO_DA_TERRA_KM * Math.asin(Math.sqrt(h));
  return Math.round(km * 10) / 10;
}
