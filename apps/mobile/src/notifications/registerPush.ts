import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { registerDevice } from "../api/workspace";

export async function ensurePushRegistration(): Promise<void> {
  if (!Device.isDevice) {
    throw new Error("Push notifications require a physical phone or tablet.");
  }
  if (Platform.OS !== "android" && Platform.OS !== "ios") {
    throw new Error("Push notifications are available in the Android and iOS apps.");
  }
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Kall alerts",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const current = await Notifications.getPermissionsAsync();
  const permission = current.granted ? current : await Notifications.requestPermissionsAsync();
  if (!permission.granted) {
    throw new Error("Allow notifications in your device settings, then try again.");
  }
  const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) {
    throw new Error("This build is missing its Expo project identity.");
  }
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await registerDevice(Platform.OS, token);
}
