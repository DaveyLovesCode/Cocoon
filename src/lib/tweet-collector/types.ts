export type CollectedTweetMedia = {
  type: 'image' | 'video' | 'gif';
  url: string;
  thumbnailUrl?: string;
  videoUrl?: string;
};

export type CollectedTweet = {
  id: string;
  url: string;
  author: string;
  handle: string;
  content: string;
  contentHtml: string;
  likes: number;
  retweets: number;
  replies: number;
  views: number;
  profilePicture: string;
  media: CollectedTweetMedia[];
  quote?: {
    id: string;
    url: string;
    author: string;
    handle: string;
    content: string;
    profilePicture: string;
    media?: CollectedTweetMedia[];
  };
  collectedAt: string;
};
