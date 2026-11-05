package gallery.memories.ui.video

import org.junit.Assert.assertEquals
import org.junit.Test

class AudioBudgetTest {
    @Test fun startupBudgetsActualBandwidth() {
        assertEquals(32000, AudioBudget(300000).rate)
        assertEquals(64000, AudioBudget(800000).rate)
        assertEquals(96000, AudioBudget(2000000).rate)
        assertEquals(192000, AudioBudget(5000000).rate)
    }

    @Test fun reductionIsFasterThanRecoveryAndNoiseCannotFlap() {
        val budget = AudioBudget(10000000)
        assertEquals(192000, budget.update(800000, 1000))
        assertEquals(64000, budget.update(800000, 4000))
        assertEquals(64000, budget.update(10000000, 5000))
        assertEquals(64000, budget.update(800000, 9000))
        assertEquals(64000, budget.update(10000000, 10000))
        assertEquals(64000, budget.update(10000000, 19999))
        assertEquals(192000, budget.update(10000000, 20000))
    }
}
