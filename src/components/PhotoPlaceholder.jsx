// Shared "no photo" state - a real, verified place can legitimately have
// zero Places photos (smaller/less-documented businesses especially), so
// this renders as a deliberate illustration instead of a blank colored box
// that could read as a broken image. Used everywhere a place/hotel photo can
// be missing: DetailView, ComparisonView, MapView, SwapPlace, Accommodation,
// FinaliseSave. className passes through the specific sizing class
// (place-card__photo / comparison-card__photo / hotel-card__photo) so this
// still fills the same box each of those already defines.
//
// Three exact illustrations from Figma (Akber's own files): a rectangular
// crop (node 438:32990) for wide 309/174 photo slots, a square crop (node
// 438:32991) for anything genuinely 1:1, and a portrait crop (node
// 440:33019) for narrower/taller boxes like comparison-card__photo's 70x90
// box - added after the square crop turned out to be an imperfect stand-in
// for that shape. All three keep preserveAspectRatio set to slice so they
// still crop cleanly to fill their box even where the container isn't an
// exact match for the artwork's own aspect ratio.
function RectPlaceholderArt() {
  return (
    <svg
      className="photo-placeholder__art"
      viewBox="0 0 553 311"
      preserveAspectRatio="xMidYMid slice"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g clipPath="url(#clip0_438_32990)">
        <rect width="553" height="311" fill="#D0F4F9" />
        <path
          d="M380.718 30.2733C407.723 27.4352 431.921 47.0219 434.77 74.0275C437.617 101.033 418.041 125.238 391.036 128.097C364.016 130.959 339.794 111.368 336.944 84.3471C334.095 57.326 353.695 33.1128 380.718 30.2733Z"
          fill="#A2E8F4"
        />
        <path
          d="M208.382 94.7499C210.816 91.8585 212.913 90.8221 215.715 93.7391C218.36 96.4939 220.652 99.2592 223.099 102.179L234.952 116.368L273.688 162.819L322.451 221.231L338.029 239.877C340.612 242.972 344.588 247.509 346.838 250.65L382.08 215.377L394.771 202.648C397.368 200.037 401.997 194.524 405.576 194.138C410.665 196.552 436.95 224.174 442.587 229.811C469.645 256.866 496.395 284.341 523.846 311H29V309.763C39.7884 296.327 51.2899 282.912 62.3271 269.661L132.946 185.133L182.178 126.086C190.886 115.621 199.62 105.161 208.382 94.7499Z"
          fill="#A2E8F4"
        />
      </g>
      <defs>
        <clipPath id="clip0_438_32990">
          <rect width="553" height="311" fill="white" />
        </clipPath>
      </defs>
    </svg>
  )
}

function SquarePlaceholderArt() {
  return (
    <svg
      className="photo-placeholder__art"
      viewBox="0 0 311 311"
      preserveAspectRatio="xMidYMid slice"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g clipPath="url(#clip0_438_32991)">
        <rect width="553" height="311" fill="#D0F4F9" />
        <path
          d="M217.51 46.2576C242.964 43.5826 265.771 62.0438 268.457 87.4978C271.14 112.952 252.689 135.765 227.235 138.461C201.768 141.158 178.938 122.693 176.252 97.2245C173.566 71.7559 192.04 48.934 217.51 46.2576Z"
          fill="#A2E8F4"
        />
        <path
          d="M55.0771 107.03C57.3712 104.304 59.3486 103.328 61.9893 106.078C64.4822 108.674 66.6418 111.28 68.9482 114.032L80.1211 127.406L116.63 171.188L162.593 226.244L177.275 243.818C179.71 246.735 183.458 251.013 185.578 253.973L218.796 220.726L230.757 208.729C233.205 206.268 237.568 201.072 240.941 200.708C245.739 202.984 270.513 229.019 275.825 234.332C301.329 259.832 326.543 285.727 352.416 310.854H-114V309.692C-103.831 297.027 -92.9889 284.382 -82.585 271.891L-16.0234 192.219L30.3789 136.565C38.5864 126.701 46.8187 116.843 55.0771 107.03Z"
          fill="#A2E8F4"
        />
      </g>
      <defs>
        <clipPath id="clip0_438_32991">
          <rect width="311" height="311" fill="white" />
        </clipPath>
      </defs>
    </svg>
  )
}

function PortraitPlaceholderArt() {
  return (
    <svg
      className="photo-placeholder__art"
      viewBox="0 0 225 311"
      preserveAspectRatio="xMidYMid slice"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g clipPath="url(#clip0_440_33019)">
        <rect x="-86" width="553" height="311" fill="#D0F4F9" />
        <path
          d="M131.51 46.2576C156.964 43.5826 179.771 62.0438 182.457 87.4978C185.14 112.952 166.689 135.765 141.235 138.461C115.768 141.158 92.9376 122.693 90.2516 97.2245C87.5657 71.7559 106.04 48.934 131.51 46.2576Z"
          fill="#A2E8F4"
        />
        <path
          d="M-30.9229 107.029C-28.629 104.304 -26.6512 103.327 -24.0107 106.077C-21.5178 108.673 -19.3581 111.279 -17.0518 114.031L-5.87891 127.405L30.6299 171.187L76.5928 226.243L91.2754 243.817C93.7098 246.734 97.4577 251.012 99.5781 253.972L132.796 220.725L144.757 208.728C147.205 206.267 151.568 201.071 154.941 200.707C159.738 202.983 184.512 229.017 189.825 234.331C215.329 259.832 240.544 285.727 266.417 310.854H-200V309.691C-189.831 297.026 -178.989 284.381 -168.585 271.89L-102.023 192.218L-55.6211 136.564C-47.4135 126.7 -39.1814 116.842 -30.9229 107.029Z"
          fill="#A2E8F4"
        />
      </g>
      <defs>
        <clipPath id="clip0_440_33019">
          <rect width="225" height="311" fill="white" />
        </clipPath>
      </defs>
    </svg>
  )
}

const PLACEHOLDER_ART = {
  rect: RectPlaceholderArt,
  square: SquarePlaceholderArt,
  portrait: PortraitPlaceholderArt,
}

export default function PhotoPlaceholder({ className = '', shape = 'rect' }) {
  const Art = PLACEHOLDER_ART[shape] || RectPlaceholderArt
  return (
    <div className={`photo-placeholder ${className}`.trim()} aria-hidden="true">
      <Art />
    </div>
  )
}
