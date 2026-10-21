export const defaultOperationalSettings = Object.freeze({
  breakfastStart: "08:00",
  breakfastEnd: "09:30",
  lunchStart: "11:30",
  lunchEnd: "14:00",
  scanBufferMinutes: 30,
});

const toMinutes = (value) => {
  const [hour, minute] = String(value).split(":").map(Number);
  return hour * 60 + minute;
};

export const getAutomaticMealType = (now = new Date(), settings = defaultOperationalSettings) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const minutes = Number(values.hour) * 60 + Number(values.minute);
  const buffer = Number(settings.scanBufferMinutes ?? 30);
  const breakfastWindow = [toMinutes(settings.breakfastStart) - buffer, toMinutes(settings.breakfastEnd) + buffer];
  const lunchWindow = [toMinutes(settings.lunchStart) - buffer, toMinutes(settings.lunchEnd) + buffer];
  if (minutes >= breakfastWindow[0] && minutes <= breakfastWindow[1]) return "breakfast";
  if (minutes >= lunchWindow[0] && minutes <= lunchWindow[1]) return "lunch";
  return minutes < lunchWindow[0] ? "breakfast" : "lunch";
};
