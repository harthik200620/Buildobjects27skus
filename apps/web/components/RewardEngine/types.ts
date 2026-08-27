export type RewardTier = 0 | 20 | 40 | 60 | 80 | 100;

/*
 * The six rooms of the cutaway house, and the state machine that walked a token round them,
 * lived here. The lift replaced both: it has floors rather than rooms, and ElevatorScene owns
 * its own phases because it owns the clock that drives them. RewardTier is the only thing that
 * outlived the house, because what a spin is worth was never about the house.
 */
