export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
};

export type AppStackParamList = {
  Applications: undefined;
  ApplicationDetail: { applicationId: number; company: string; role: string };
  MorningBrief: undefined;
};
