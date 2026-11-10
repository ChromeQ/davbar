// Ways to give the web app an image besides choosing a file: its web address, a
// copied picture pasted in, or an image dragged in from another tab.

// What a paste or drop carries: DataTransfer has these.
type Transfer = {
  files: ArrayLike<File>;
  getData: (format: string) => string;
};

// An image's web address, or the image itself as a data: address.
export const isImageAddress = (text: string) => /^(https?:\/\/\S+|data:image\/\S+)$/i.test(text);

// A copied picture: Copy Image in a browser, or a screenshot.
export const imageFile = (transfer: Transfer): File | null =>
  Array.from(transfer.files).find((file) => file.type.startsWith('image/')) ?? null;

// A copied or dragged image address. A dragged image gives its address as the
// first line of text/uri-list that isn't a comment.
export const imageAddress = (transfer: Transfer): string | null => {
  const uris = transfer
    .getData('text/uri-list')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  const address = uris[0] ?? transfer.getData('text/plain').trim();

  return isImageAddress(address) ? address : null;
};

export const NOT_AN_IMAGE_ADDRESS =
  "That address isn't an image. Right-click the image itself and choose Copy Image Address.";

// The image at a web address. The browser can only read images from sites that
// let other pages read them, as KegLand's image server does.
export const fetchImage = async (address: string): Promise<Blob> => {
  let response: Response;

  try {
    response = await fetch(address);
  } catch {
    throw new Error(
      "The image couldn't be loaded. The site may not let other pages read its images: " +
        'copy the image itself and paste it here, or save it and choose it with Browse.'
    );
  }

  if (!response.ok) {
    throw new Error(
      `The image couldn't be loaded: the site answered with status ${response.status}.`
    );
  }

  const blob = await response.blob();

  if (blob.type.startsWith('text/')) {
    throw new Error(NOT_AN_IMAGE_ADDRESS);
  }

  return blob;
};
