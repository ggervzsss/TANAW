import { describe, expect, it } from "vitest";
import { barangayLeaders, enterprisesInBarangay, pinAriaLabel, visiblePins } from "@/features/admin-dashboard/model/mapPins";
import { mapEnterprise } from "./fixtures";

const church = mapEnterprise({ id: "church", name: "Pilgrim Church", barangay: "Landayan", totalLiveOccupancy: 40 });
const walk = mapEnterprise({ id: "walk", name: "Heritage Walk", barangay: "Landayan", totalLiveOccupancy: 12 });
const plaza = mapEnterprise({ id: "plaza", name: "City Plaza", barangay: "Poblacion", totalLiveOccupancy: null });
const pacita = mapEnterprise({ id: "pacita", name: "Sports Complex", barangay: "Pacita I" });
const all = [church, walk, plaza, pacita];

describe("dashboard map pins", () => {
  it("shows the busiest enterprise of each barangay in the city view", () => {
    expect(barangayLeaders(all).map(({ id }) => id)).toEqual(["church", "plaza", "pacita"]);
    expect(visiblePins(all, null)).toHaveLength(3);
  });

  it("breaks ties by today's visitors, then by name", () => {
    const a = mapEnterprise({ id: "a", name: "Beta", barangay: "Nueva", estimatedUniqueCount: 5 });
    const b = mapEnterprise({ id: "b", name: "Alpha", barangay: "Nueva", estimatedUniqueCount: 9 });
    const c = mapEnterprise({ id: "c", name: "Aardvark", barangay: "Nueva", estimatedUniqueCount: 9 });
    expect(barangayLeaders([a, b, c]).map(({ id }) => id)).toEqual(["c"]);
  });

  it("shows every enterprise of an open barangay, matching spelling variants", () => {
    expect(visiblePins(all, "Landayan").map(({ id }) => id)).toEqual(["church", "walk"]);
    expect(enterprisesInBarangay(all, "Pacita 1").map(({ id }) => id)).toEqual(["pacita"]);
  });

  it("names a pin, its busy state and what selecting it does", () => {
    expect(pinAriaLabel(church, { busy: true, leader: true, barangayCount: 2 })).toBe(
      "Pilgrim Church, Barangay Landayan. Busier than usual. Busiest in its barangay. Select to see all 2 enterprises here.",
    );
    expect(pinAriaLabel(plaza, { busy: false, leader: true, barangayCount: 1 })).toBe("City Plaza, Barangay Poblacion. Select to show its details link.");
  });
});
