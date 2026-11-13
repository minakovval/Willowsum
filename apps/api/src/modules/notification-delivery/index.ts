// Public interface of the notification-delivery module (ARC-01 FR 2). Other modules import only this file.
import { defineModule } from "../../platform/modules/define.ts";

export const notificationDeliveryModule = defineModule({
  name: "notification-delivery",
  publishes: [],
  consumes: [],
});
