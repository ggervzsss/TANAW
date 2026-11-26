import { describe, expect, it } from "vitest";
import { getSettingsSaveBarState } from "@/shared/ui-kit/lib/settingsDraft";

describe("settings save bar", () => {
  it("stays hidden while the form matches what is saved", () => {
    expect(getSettingsSaveBarState({ dirty: false, busy: false })).toEqual({ status: "idle", visible: false, showDiscard: false });
  });

  it("appears with Discard once something changes", () => {
    expect(getSettingsSaveBarState({ dirty: true, busy: false })).toEqual({ status: "dirty", visible: true, showDiscard: true });
  });

  it("stays in view while saving, keeping Discard in place", () => {
    expect(getSettingsSaveBarState({ dirty: true, busy: true })).toEqual({ status: "saving", visible: true, showDiscard: true });
    expect(getSettingsSaveBarState({ dirty: false, busy: true })).toMatchObject({ status: "saving", visible: true, showDiscard: false });
  });

});
