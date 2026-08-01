function toYYMMDD(isoDate) {
  const [y, m, d] = isoDate.split("-");
  return y.slice(2) + m + d;
}

function buildLinks(origin, destination, start, end, cabin) {
  const O = origin.toUpperCase();
  const D = destination.toUpperCase();
  const cabinLabel = cabin === "business" ? "executiva" : "econômica";
  const skyStart = toYYMMDD(start);
  const skyEnd = toYYMMDD(end);

  const aggregators = [
    {
      name: "Kayak",
      url: `https://www.kayak.com.br/flights/${O}-${D}/${start}/${end}${cabin === "business" ? "/business" : ""}?sort=bestflight_a`,
    },
    {
      name: "Google Flights",
      url: `https://www.google.com/travel/flights?q=${encodeURIComponent(
        `Voos de ${O} para ${D} ida ${start} volta ${end} classe ${cabinLabel}`
      )}`,
    },
    {
      name: "Skyscanner",
      url: `https://www.skyscanner.com.br/transporte/passagens-aereas/${O}/${D}/${skyStart}/${skyEnd}/?adultos=1&cabinclass=${cabin}`,
    },
  ];

  const airlines = [
    {
      name: "LATAM",
      url: `https://www.latamairlines.com/br/pt/oferta-voos?origin=${O}&destination=${D}&outbound=${start}T00:00:00.000Z&inbound=${end}T00:00:00.000Z&adt=1&trip=RT&cabin=${
        cabin === "business" ? "Premium Business" : "Economy"
      }`,
    },
    {
      name: "GOL",
      url: `https://b2c.voegol.com.br/?adults=1&children=0&infants=0&tripType=roundtrip&originAirportCode=${O}&destinationAirportCode=${D}&departureDate=${start}&returnDate=${end}&cabinType=${
        cabin === "business" ? "EXECUTIVE" : "ECONOMIC"
      }`,
    },
    {
      name: "Azul",
      url: `https://www.voeazul.com.br/br/pt/home/passagens?origin=${O}&destination=${D}&departureDate=${start}&returnDate=${end}&adults=1&cabin=${cabin}`,
    },
    {
      name: "American Airlines",
      url: `https://www.aa.com/booking/find-flights?origin=${O}&destination=${D}&departDate=${start}&returnDate=${end}&cabin=${
        cabin === "business" ? "BUSINESS" : "COACH"
      }&adult=1&locale=pt_BR`,
    },
    {
      name: "United",
      url: `https://www.united.com/en/us/fsr/choose-flights?f=${O}&t=${D}&d=${start}&r=${end}&tt=1&px=1&taxng=1&newHP=True&clm=7&st=bestmatches&cabin=${
        cabin === "business" ? "business" : "economy"
      }`,
    },
  ];

  return { aggregators, airlines };
}

function renderLinks(containerId, links) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  links.forEach((link) => {
    const a = document.createElement("a");
    a.href = link.url;
    a.target = "_blank";
    a.rel = "noopener";
    a.className = "flight-result-link";
    a.textContent = link.name;
    container.appendChild(a);
  });
}

const form = document.getElementById("flight-form");
const error = document.getElementById("flight-form-error");
const results = document.getElementById("flight-results");

form.addEventListener("submit", (e) => {
  e.preventDefault();

  const origin = document.getElementById("origin").value.trim();
  const destination = document.getElementById("destination").value.trim();
  const start = document.getElementById("start-date").value;
  const end = document.getElementById("end-date").value;
  const cabin = document.getElementById("cabin").value;

  const validCode = /^[A-Za-z]{3}$/;
  if (!validCode.test(origin) || !validCode.test(destination) || !start || !end || end < start) {
    error.style.display = "block";
    results.hidden = true;
    return;
  }
  error.style.display = "none";

  const { aggregators, airlines } = buildLinks(origin, destination, start, end, cabin);
  renderLinks("flight-results-aggregators", aggregators);
  renderLinks("flight-results-airlines", airlines);
  results.hidden = false;
});
