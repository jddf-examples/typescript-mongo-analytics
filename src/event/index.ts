export interface EventPageViewed {
  type: "Page Viewed";
  timestamp: string;
  url: string;
  userId: string;
}

export interface EventHeartbeat {
  type: "Heartbeat";
  userId: string;
  timestamp: string;
}

export interface EventOrderCompleted {
  type: "Order Completed";
  userId: string;
  revenue: number;
  timestamp: string;
}

export type Event = EventPageViewed | EventHeartbeat | EventOrderCompleted;

