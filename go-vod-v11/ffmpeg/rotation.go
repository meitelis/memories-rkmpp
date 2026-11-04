package ffmpeg

// NormalizeRotation uses the display-matrix convention: positive angles rotate
// counterclockwise. Equivalent turns must produce the same filter and metadata.
func NormalizeRotation(rotation int) int {
	rotation %= 360
	if rotation > 180 {
		rotation -= 360
	} else if rotation <= -180 {
		rotation += 360
	}
	return rotation
}

func SwapsAxes(rotation int) bool {
	r := NormalizeRotation(rotation)
	return r == 90 || r == -90
}
