<script lang="ts">
	type Props = {
		size?: number;
		mouthProgress?: number;
		color?: string;
	};

	let { size = 32, mouthProgress = 1, color = '#A8E6CF' }: Props = $props();

	// Calculate mouth path based on progress
	let mouthPath = $derived.by(() => {
		const mouthY = 38.4;
		const mouthHeight = 8;
		const controlY = mouthY + (mouthProgress * 2 - 1) * mouthHeight;
		return `M 24 ${mouthY} Q 32 ${controlY} 40 ${mouthY}`;
	});
</script>

<svg width={size} height={size} viewBox="0 0 64 64" fill="none">
	<!-- Face circle (faceSize = 32, so radius = 32) -->
	<circle cx="32" cy="32" r="32" fill={color} />

	<!-- Eyes: faceX ± faceSize*0.3, faceY - faceSize*0.15, radius faceSize*0.12 -->
	<circle cx="22.4" cy="27.2" r="3.84" fill="rgba(0, 0, 0, 0.6)" />
	<circle cx="41.6" cy="27.2" r="3.84" fill="rgba(0, 0, 0, 0.6)" />

	<!-- Mouth: interpolated based on mouthProgress -->
	<path
		d={mouthPath}
		stroke="rgba(0, 0, 0, 0.6)"
		stroke-width="2.56"
		stroke-linecap="round"
		fill="none"
	/>
</svg>
