const COUNTRY_CENTROIDS = [
  { lat: 39.9042, lng: 116.4074, labelZh: '中国', labelEn: 'China' },
  { lat: 38.9072, lng: -77.0369, labelZh: '美国', labelEn: 'United States' },
  { lat: 51.5074, lng: -0.1278, labelZh: '英国', labelEn: 'United Kingdom' },
  { lat: 35.6762, lng: 139.6503, labelZh: '日本', labelEn: 'Japan' },
  { lat: 48.8566, lng: 2.3522, labelZh: '法国', labelEn: 'France' },
  { lat: 52.52, lng: 13.405, labelZh: '德国', labelEn: 'Germany' },
  { lat: -33.8688, lng: 151.2093, labelZh: '澳大利亚', labelEn: 'Australia' },
  { lat: 43.6532, lng: -79.3832, labelZh: '加拿大', labelEn: 'Canada' },
  { lat: 1.3521, lng: 103.8198, labelZh: '新加坡', labelEn: 'Singapore' },
  { lat: 25.2048, lng: 55.2708, labelZh: '阿联酋', labelEn: 'United Arab Emirates' },
  { lat: 19.076, lng: 72.8777, labelZh: '印度', labelEn: 'India' },
  { lat: -23.5505, lng: -46.6333, labelZh: '巴西', labelEn: 'Brazil' },
  { lat: 55.7558, lng: 37.6173, labelZh: '俄罗斯', labelEn: 'Russia' },
  { lat: 37.5665, lng: 126.978, labelZh: '韩国', labelEn: 'South Korea' },
  { lat: 25.033, lng: 121.5654, labelZh: '台湾', labelEn: 'Taiwan' },
  { lat: 22.3193, lng: 114.1694, labelZh: '香港', labelEn: 'Hong Kong' },
  { lat: 41.9028, lng: 12.4964, labelZh: '意大利', labelEn: 'Italy' },
  { lat: 40.4168, lng: -3.7038, labelZh: '西班牙', labelEn: 'Spain' },
  { lat: 52.3676, lng: 4.9041, labelZh: '荷兰', labelEn: 'Netherlands' },
  { lat: 59.3293, lng: 18.0686, labelZh: '瑞典', labelEn: 'Sweden' },
  { lat: 60.1699, lng: 24.9384, labelZh: '芬兰', labelEn: 'Finland' },
  { lat: 47.3769, lng: 8.5417, labelZh: '瑞士', labelEn: 'Switzerland' },
  { lat: 50.8503, lng: 4.3517, labelZh: '比利时', labelEn: 'Belgium' },
  { lat: 59.9139, lng: 10.7522, labelZh: '挪威', labelEn: 'Norway' },
  { lat: 55.6761, lng: 12.5683, labelZh: '丹麦', labelEn: 'Denmark' },
  { lat: 64.1466, lng: -21.9426, labelZh: '冰岛', labelEn: 'Iceland' },
  { lat: 31.2304, lng: 121.4737, labelZh: '上海', labelEn: 'Shanghai' },
  { lat: 22.5431, lng: 114.0579, labelZh: '深圳', labelEn: 'Shenzhen' },
  { lat: 23.1291, lng: 113.2644, labelZh: '广州', labelEn: 'Guangzhou' },
  { lat: 30.5728, lng: 104.0668, labelZh: '成都', labelEn: 'Chengdu' },
]

function normalizeCountryKey(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '')
}

export function lookupCountryCentroid(country: string) {
  const key = normalizeCountryKey(country)
  if (!key) return null
  return (
    COUNTRY_CENTROIDS.find(
      (item) =>
        normalizeCountryKey(item.labelZh) === key ||
        normalizeCountryKey(item.labelEn) === key ||
        key.includes(normalizeCountryKey(item.labelZh)) ||
        key.includes(normalizeCountryKey(item.labelEn)),
    ) ?? null
  )
}
