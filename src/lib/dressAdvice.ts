// «KLE PÅ SEG»-rådet på vær-kortet (Gangskjerm). Logikken er flyttet uendret ut av
// WeatherCard så den kan brukes for både i dag og kommende dager (daily).

export interface DressAdvice { text: string; spreadWarning: boolean }

/**
 * @param max       dagens høyeste temperatur
 * @param min       dagens laveste temperatur
 * @param category  dagens kategori (clear/fair/cloudy/rain/snow/thunder/fog)
 * @param precip    dagens samlede nedbør i mm
 */
export function dressAdvice(max: number, min: number, category: string, precip: number): DressAdvice {
  const rain = category === 'rain' || category === 'thunder' || precip > 1;
  const snow = category === 'snow';
  let text: string;
  if (snow || max < 0) text = '❄️ Vinterklær! Husk lue og jakke';
  else if (max < 8)    text = '🥶 Vurder å ta på vinterjakke';
  else if (max < 15)   text = rain ? '🌧️ Husk regnjakke! Lurt å ha noe under også' : '🍂 Burde ha med genser eller en tynn jakke';
  else if (max < 20)   text = rain ? '☔ Regnjakke! Og kan være lurt å ha på noe under' : '🌤️ Kan være lurt å ta med genser eller tynn jakke';
  else                 text = rain ? '🌦️ Regnjakke hvis du vil holde deg tørr' : '🏖️ SOMMERKLÆR!! Kjempefint vær';

  const spreadWarning = min < 15 && (max - min) >= 5 && max >= 8;
  return { text, spreadWarning };
}
