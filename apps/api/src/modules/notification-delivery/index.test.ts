import { describe, expect, it } from "vitest";
import { notificationDeliveryModule } from "./index.ts";

describe("notification-delivery module", () => {
  it("declares its public interface", () => {
    expect(notificationDeliveryModule.name).toBe("notification-delivery");
  });
});
