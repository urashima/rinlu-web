import XCTest

final class ListeningUITests: XCTestCase {
    func testPlatformListeningFlow() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        let featured = app.buttons.matching(identifier: "featuredSong").first
        XCTAssertTrue(featured.waitForExistence(timeout: 50), app.debugDescription)
        capture("Home",app)
        featured.tap()
        let mini = app.buttons["openPlayer"]
        XCTAssertTrue(mini.waitForExistence(timeout: 10))
        mini.tap()
        XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 60), app.debugDescription)
        capture("Player",app)
        app.buttons["Pause"].tap()
        XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 8))
        app.buttons["Queue"].tap()
        XCTAssertTrue(app.buttons["Close player"].exists)
        app.buttons["Close player"].tap()
        app.tabBars.buttons["Search"].tap()
        XCTAssertTrue(app.searchFields.firstMatch.waitForExistence(timeout: 8))
        app.tabBars.buttons["Library"].tap()
        app.buttons["Creator Studio"].tap()
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 15))
        app.buttons["Done"].tap()
        XCTAssertTrue(app.buttons["openPlayer"].waitForExistence(timeout: 15))
    }
    private func capture(_ name:String,_ app:XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name=name;attachment.lifetime = .keepAlways;add(attachment)
    }
}
