import { describe, expect, it } from "vitest";
import { mapAlertsPlaces, mapAlertsSignature, mapAlertsTitle, mapAlertsTone } from "@/features/admin-dashboard/model/mapAlerts";

const busy = (id: string, name: string) => ({ id, type: "Busier Than Usual" as const, enterpriseId: `ENT-${name}`, enterpriseName: name });
const camera = (id: string, name: string) => ({ id, type: "Camera Not Counting" as const, enterpriseId: `ENT-${name}`, enterpriseName: name });

describe("map alerts card", () => {
  it("titles one alert by its kind and several by count", () => {
    expect(mapAlertsTitle([busy("1", "Plaza")])).toBe("More visitors than usual");
    expect(mapAlertsTitle([camera("1", "Plaza")])).toBe("Camera not counting");
    expect(mapAlertsTitle([camera("1", "Plaza"), camera("2", "Market")])).toBe("2 cameras not counting");
    expect(mapAlertsTitle([busy("1", "Plaza"), busy("2", "Market")])).toBe("More visitors than usual at 2 places");
    expect(mapAlertsTitle([busy("1", "Plaza"), camera("2", "Market"), camera("3", "Market")])).toBe("3 live alerts");
  });

  it("uses the camera tone when any camera is down and the busy tone otherwise", () => {
    expect(mapAlertsTone([busy("1", "Plaza")])).toBe("busy");
    expect(mapAlertsTone([camera("1", "Plaza")])).toBe("camera");
    expect(mapAlertsTone([busy("1", "Plaza"), camera("2", "Market")])).toBe("mixed");
  });

  it("names each place once", () => {
    expect(mapAlertsPlaces([camera("1", "Plaza"), camera("2", "Plaza")])).toBe("Plaza");
    expect(mapAlertsPlaces([camera("1", "Plaza"), busy("2", "Market")])).toBe("Plaza and Market");
    expect(mapAlertsPlaces([busy("1", "Plaza"), busy("2", "Market"), busy("3", "Hall"), busy("4", "Park")])).toBe("Plaza, Market and 2 more");
  });

  it("remembers a dismissal until an alert starts or ends, in any order", () => {
    expect(mapAlertsSignature([{ id: "b" }, { id: "a" }])).toBe(mapAlertsSignature([{ id: "a" }, { id: "b" }]));
    expect(mapAlertsSignature([{ id: "a" }])).not.toBe(mapAlertsSignature([{ id: "a" }, { id: "b" }]));
  });
});
