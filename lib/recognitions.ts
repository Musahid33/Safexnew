export type RecognitionItem = {
  id: string;
  employeeName: string;
  rewardFor: string;
  imageUrl: string | null;
  artworkIndex: number;
};

export type AdminRecognitionItem = RecognitionItem & {
  consentConfirmed: boolean;
  isPublished: boolean;
  sortOrder: number;
};
